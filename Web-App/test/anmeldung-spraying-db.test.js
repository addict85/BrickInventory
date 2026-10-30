/**
 * Password-Spraying: Je Adresse gilt eine Grenze über ALLE Namen, nicht nur
 * fünf Versuche je Konto. Und abgelaufene Zähler verschwinden wieder.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in checkLoginAllowed die Reservierung des Adressschlüssels entfernt →
 *      rot: „nach 30 Fehlversuchen gegen verschiedene Namen …“
 *   B  raeumeAnmeldezaehlerAuf() löscht nichts (`AND FALSE`) → rot:
 *      „abgelaufene Zähler werden gelöscht …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `spray_${process.pid}`;
const IP = '203.0.113.77';

test('Grenze je Adresse über alle Namen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, 1, 1) RETURNING id`, [NAME, bcrypt.hashSync('richtig-geheim', 4)])).id;
  const aufraeumen = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE 'probe-alt|%' OR key = 'probe-neu|x'`, [`%${IP}%`]);
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`%konto:${uid}`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { pruefeAnmeldedaten } = _req('utils/auth.js');
  const lim = _req('utils/loginLimiter.js');

  await t.test('nach 30 Fehlversuchen gegen verschiedene Namen ist die Adresse gesperrt', async () => {
    const anfrage = { ip: IP, socket: {}, headers: {} };
    for (let i = 0; i < lim.MAX_JE_ADRESSE; i++) {
      const r = await pruefeAnmeldedaten(anfrage, `${NAME}_gibtsnicht_${i}`, 'falsch');
      assert.equal(r.absage?.status, 401, `Versuch ${i + 1}`);
    }
    const r = await pruefeAnmeldedaten(anfrage, NAME, 'richtig-geheim');
    assert.equal(r.absage?.status, 429);
  });

  await t.test('abgelaufene Zähler werden gelöscht, frische bleiben', async () => {
    await db.run(`INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES
      ('probe-alt|1', 3, NOW() - interval '3 days', NOW() - interval '2 days'),
      ('probe-neu|x', 1, NOW(), NOW())`);
    await lim.raeumeAnmeldezaehlerAuf();
    const da = (await db.all(`SELECT key FROM rate_limit_attempts WHERE key IN ('probe-alt|1','probe-neu|x')`)).map(z => z.key);
    assert.deepEqual(da, ['probe-neu|x']);
  });
});
