/**
 * The setup state before login: public, but without accounts and
 * without keys; without a session the entry only lets this path through.
 *
 * Counter-checks:
 *   A  account counter removed in setupStatus.ts → red: „für den Verwalter steht das Konto erst auf bereit, …“
 *   B  path deleted from PUBLIC                    → red: 401 instead of 200
 *   C  users row taken into the response            → red: „keine Adressen, keine Namen“
 *   D  BrickLink/Rebrickable check removed in setupStatus.ts → red: „mit hinterlegter Quelle gilt die Einrichtung als begonnen“
 *   E  in routes/api_v1/setup.ts `verwalter: true` fixed (07.11.2026)
 *      → red: „ohne Verwalter verrät der Stand kein Startpasswort“
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

// An open connection from the pool keeps the process alive; in the full run the
// whole file then stands still instead of ending. Hence the file closes its pool itself.
after(() => db.pool.end().catch(() => {}));

test('setup state without login', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const schluessel = ['einrichtung_erledigt', 'rebrickable_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
    for (const z of vorher) {
      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [z.key, z.value],
      );
    }
  });

  const name = `es_${process.pid}`;
  const uid = (
    await db.get(
      "INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1,'x',true,true) RETURNING id",
      [name],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]));

  const srv = testServer(_req, { sitzung: {}, t });
  const r = await fetch(srv.base + '/api/v2/setup/state');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.success, true);
  assert.equal(d.done, false);
  assert.equal(d.configured, false, 'ohne Quelle ist nichts konfiguriert');
  assert.equal(d.ca.download, '/ca.crt');
  assert.ok(Array.isArray(d.steps) && d.steps.length >= 5, 'die Prüfungen fehlen');
  for (const s of d.steps) {
    assert.equal(typeof s.ok, 'boolean');
    assert.equal(typeof s.required, 'boolean');
  }
  // An initial password is still set; without an admin „konto“ only means „there is one“.
  const konto = d.steps.find(s => s.id === 'konto');
  assert.equal(konto.ok, true, 'ohne Verwalter verrät der Stand kein Startpasswort');
  assert.equal(d.base_url, null, 'ohne Verwalter keine Basis-URL');
  const verwalter = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t });
  const dv = await (await fetch(verwalter.base + '/api/v2/setup/state')).json();
  assert.equal(
    dv.steps.find(s => s.id === 'konto').ok,
    false,
    'für den Verwalter steht das Konto erst auf bereit, wenn das Startpasswort ersetzt ist',
  );
  // No addresses, no names, no key names.
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, new RegExp(name));
  assert.doesNotMatch(text, /api_key|smtp_|password/i);

  // A stored source ends the initial setup: the check button disappears.
  // Via the real write path, because keys lie encrypted (SECRET_KEYS).
  await _req('src/settings/settings.js').setGlobalSetting('rebrickable_api_key', 'probe');
  const d2 = await (await fetch(srv.base + '/api/v2/setup/state')).json();
  assert.equal(d2.configured, true, 'mit hinterlegter Quelle gilt die Einrichtung als begonnen');
});

test('the entry lets only the state through without a session', async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  const app = express();
  const mw = _req('routes/api_v1/middleware.js');
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', mw.guardFor(require('./helpers/sources').testServices().account).loginAtInbox);
  app.use('/api/v2', (req, res) => res.json({ success: true, path: req.path }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const address = srv.address();
  const base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}/api/v2`;

  const open = await fetch(base + '/setup/state');
  assert.equal(open.status, 200, 'der Stand muss vor der Anmeldung erreichbar sein');
  const zu = await fetch(base + '/sets');
  assert.equal(zu.status, 401, 'alles andere bleibt zu');
});
