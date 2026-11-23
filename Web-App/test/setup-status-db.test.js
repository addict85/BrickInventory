/**
 * The setup state before login: public, but without accounts and
 * without keys; without a session the entry only lets this path through.
 *
 * Counter-checks:
 *   A  account counter removed in setupStatus.ts → red: „für den Verwalter steht das Konto erst auf bereit, …“
 *   B  path deleted from PUBLIC                    → red: 401 instead of 200
 *   C  users row taken into the response            → red: „keine Adressen, keine Namen“
 *   D  BrickLink/Rebrickable check removed in setupStatus.ts → red: „mit hinterlegter Quelle gilt die Einrichtung als begonnen“
 *   E  in routes/api/setup.ts `verwalter: true` fixed (07.11.2026)
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
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const key = ['einrichtung_erledigt', 'rebrickable_api_key'];
  const prior = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [key]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [key]);
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [key]);
    for (const z of prior) {
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

  const srv = testServer(_req, { session: {}, t });
  const r = await fetch(srv.base + '/api/v2/setup/state');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.success, true);
  assert.equal(d.done, false);
  assert.equal(d.configured, false, 'without a source nothing is configured');
  assert.equal(d.ca.download, '/ca.crt');
  assert.ok(Array.isArray(d.steps) && d.steps.length >= 5, 'the checks are missing');
  for (const s of d.steps) {
    assert.equal(typeof s.ok, 'boolean');
    assert.equal(typeof s.required, 'boolean');
  }
  // An initial password is still set; without an admin „konto“ only means „there is one“.
  const account = d.steps.find(s => s.id === 'account');
  assert.equal(account.ok, true, 'without an admin the state reveals no start password');
  assert.equal(d.base_url, null, 'without an admin no base URL');
  const admin = testServer(_req, { session: { userId: uid, isAdmin: true }, t });
  const dv = await (await fetch(admin.base + '/api/v2/setup/state')).json();
  assert.equal(
    dv.steps.find(s => s.id === 'account').ok,
    false,
    'for the admin the account only becomes ready once the start password is replaced',
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
  assert.equal(d2.configured, true, 'with a stored source the setup counts as started');
});

test('the entry lets only the state through without a session', async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const app = express();
  const mw = _req('routes/api/middleware.js');
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', mw.guardFor(require('./helpers/sources').testServices().account).loginAtInbox);
  app.use('/api/v2', (req, res) => res.json({ success: true, path: req.path }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const address = srv.address();
  const base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}/api/v2`;

  const open = await fetch(base + '/setup/state');
  assert.equal(open.status, 200, 'the state must be reachable before the login');
  const closed = await fetch(base + '/sets');
  assert.equal(closed.status, 401, 'everything else stays closed');
});
