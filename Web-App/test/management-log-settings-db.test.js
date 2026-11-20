/**
 * Das Verwaltungsprotokoll hält auch Änderungen an Servereinstellungen fest —
 * Mailserver (wohin die Rücksetzlinks gehen), Zugangsschlüssel,
 * Registrierung: wer, wann, welche Schlüssel, nie die Werte. Ein unverändert
 * zurückgeschicktes Formular schreibt keinen Eintrag.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  protokolliere() in POST /settings gestrichen → rot: beide Fälle
 *   B  der Vergleich mit dem alten Wert gestrichen (jeder gesendete Schlüssel
 *      zählt) → rot: „unverändert …"
 *   C  in saveSettings() die Schreibvorgänge ohne kx.transaktion()
 *      (direkt nacheinander) → rot: „scheitert ein Kontowert …“ (smtp_host
 *      und Protokolleintrag blieben stehen; 13.11.2026 mit `language: 'xx'`)
 *   D  (13.11.2026) die Währung wieder in der Schleife innerhalb von kx.transaktion()
 *      → rot: „eine gültige Währung …“ (500: BesideTheTransaction, weil der
 *      Haushaltswechsel den Systemrahmen braucht)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = Buffer.alloc(32, 5).toString('base64');

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('server settings in the admin log', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const CHEF = `protokoll_${process.pid}`,
    PASS = 'Protokoll-Pruefung-3';
  const SCHLUESSEL = ['smtp_host', 'rebrickable_api_key', 'registration_enabled'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  await db.run('DELETE FROM users WHERE username = $1', [CHEF]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`,
      [CHEF, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM admin_log WHERE admin_id = $1', [uid]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const { base } = routerServer(_req, {
    sitzung: { userId: uid, isAdmin: true },
    apiNutzer: { user_id: uid, is_admin: 1 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const speichere = rumpf =>
    fetch(`${base}/api/v1/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_password: PASS, ...rumpf }),
    }).then(async r => [r.status, await r.json()]);
  const eigene = async () =>
    (await (await fetch(`${base}/api/v1/admin/protokoll`)).json()).eintraege.filter(e => e.admin_id === uid);
  const GEHEIM = 'Rebrickable-Geheim-4711';

  await t.test('a change is recorded with the keys, not with the values', async () => {
    const [status, b] = await speichere({
      smtp_host: 'mail.neu.example',
      rebrickable_api_key: GEHEIM,
      registration_enabled: '0',
    });
    assert.equal(status, 200, JSON.stringify(b));
    const e = await eigene();
    assert.equal(e.length, 1, JSON.stringify(e));
    assert.equal(e[0].action, 'einstellungen_geaendert');
    assert.deepEqual(e[0].details.split(', ').sort(), ['rebrickable_api_key', 'registration_enabled', 'smtp_host']);
    assert.ok(!JSON.stringify(e).includes(GEHEIM) && !JSON.stringify(e).includes('mail.neu.example'));
  });

  await t.test('sent back unchanged writes no entry', async () => {
    const [status] = await speichere({
      smtp_host: 'mail.neu.example',
      rebrickable_api_key: GEHEIM,
      registration_enabled: '0',
    });
    assert.equal(status, 200);
    assert.equal((await eigene()).length, 1);
  });

  await t.test('if an account value fails, global values and log stay as before', async () => {
    const [status, b] = await speichere({ smtp_host: 'mail.halb.example', language: 'xx' });
    assert.deepEqual([status, b.code], [400, 'wert_ungueltig']);
    assert.equal(
      (await db.get(`SELECT value FROM global_settings WHERE key = 'smtp_host'`))?.value,
      'mail.neu.example',
    );
    assert.equal((await eigene()).length, 1, 'kein Eintrag für eine Änderung, die nicht gilt');
  });

  await t.test('… also with an invalid currency that is checked before the transaction', async () => {
    const [status, b] = await speichere({ smtp_host: 'mail.halb.example', currency: 'XYZ' });
    assert.deepEqual([status, b.code], [400, 'wert_ungueltig']);
    assert.equal(
      (await db.get(`SELECT value FROM global_settings WHERE key = 'smtp_host'`))?.value,
      'mail.neu.example',
    );
    assert.equal((await eigene()).length, 1, 'kein Eintrag für eine Änderung, die nicht gilt');
  });

  await t.test('a valid currency applies together with the other account values', async () => {
    const [status, b] = await speichere({ currency: 'USD', language: 'en' });
    assert.equal(status, 200, JSON.stringify(b));
    const werte = await db.all(
      `SELECT key, value FROM user_settings WHERE user_id = $1 AND key IN ('currency', 'language') ORDER BY key`,
      [uid],
    );
    assert.deepEqual(
      werte.map(w => `${w.key}=${w.value}`),
      ['currency=USD', 'language=en'],
    );
  });
});
