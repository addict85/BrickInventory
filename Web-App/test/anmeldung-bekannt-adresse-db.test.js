/**
 * Die 30 Tage gemerkte „bekannte Anmeldung“ legt keine Klartext-Adresse in
 * rate_limit_attempts ab, und der Vorrang bekannter Anmeldungen wirkt weiter.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  _bekanntKey und _erfolgKey nehmen wieder drosselAdresse(ip) statt des
 *      Abdrucks → rot: „keine Klartext-Adresse“
 *   B  adressAbdruck liefert je Aufruf einen anderen Wert → rot: „bekannt
 *      bleibt bekannt“
 *   C  adressAbdruck liefert für jede Adresse denselben Wert → rot: „andere
 *      Adresse ist unbekannt“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();
const limiter = _req('src/konto/loginLimiter.js');

test('bekannte Anmeldung: Adresse nur als Abdruck gespeichert', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const name = `bk_${process.pid}`;
  const IP = '203.0.113.77',
    IP6 = '2001:db8:1:2:3:4:5:6';
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name])).id;
  const aufraeumen = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE '%|konto:${uid}'`).catch(() => {});
  t.after(async () => {
    await aufraeumen();
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await limiter.anmeldungGelungen(IP, name);
  await limiter.anmeldungGelungen(IP6, name);

  await t.test('keine Klartext-Adresse', async () => {
    const zeilen = await db.all(
      `SELECT key FROM rate_limit_attempts WHERE key LIKE 'login-bekannt|%' OR key LIKE 'login-erfolg|%'`,
    );
    const meine = zeilen.filter(z => z.key.endsWith(`|konto:${uid}`));
    assert.equal(meine.length, 4, 'je Adresse eine Bekannt- und eine Erfolgszeile');
    for (const { key } of meine) {
      assert.ok(!key.includes('203.0.113') && !key.includes('2001:db8'), `Klartext in ${key}`);
    }
  });

  await t.test('bekannt bleibt bekannt', async () => {
    assert.equal(await limiter.bekannteAnmeldung(IP, name), true);
    assert.equal(await limiter.bekannteAnmeldung(IP6, name), true);
    // Dasselbe /64 zählt als dieselbe Adresse.
    assert.equal(await limiter.bekannteAnmeldung('2001:db8:1:2:ffff::1', name), true);
  });

  await t.test('andere Adresse ist unbekannt', async () => {
    assert.equal(await limiter.bekannteAnmeldung('203.0.113.78', name), false);
  });
});
