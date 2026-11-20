/**
 * Password-Spraying: Je Adresse gilt eine Grenze über ALLE Namen, nicht nur
 * fünf Versuche je Konto. Und abgelaufene Zähler verschwinden wieder.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in loginAllowed die Reservierung des Adressschlüssels entfernt →
 *      rot: „nach 30 Fehlversuchen gegen verschiedene Namen …“
 *   B  cleanLoginCounterOn() löscht nichts (`AND FALSE`) → rot:
 *      „abgelaufene Zähler werden gelöscht …“
 *
 * Eine Flut fremder Fehlversuche sperrt den Inhaber auf seinem bekannten Gerät
 * nicht aus (hinter einem Proxy teilen sich alle eine Adresse).
 * Gegenprobe (13.11.2026 gemessen):
 *   C  in loginAllowed `bekannt ||` vor der Gesamtsperre gestrichen →
 *      rot: „bekannt: trotz gesperrter Adresse angemeldet“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const NAME = `spray_${process.pid}`;
const IP = '203.0.113.77';

test('limit per address across all names', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync('richtig-geheim', 4)],
    )
  ).id;
  const aufraeumen = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE 'probe-alt|%' OR key = 'probe-neu|x'`, [
      `%${IP}%`,
    ]);
  await aufraeumen();
  t.after(async () => {
    await aufraeumen();
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`%konto:${uid}`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { checkCredentials } = _req('src/account/loginCheck.js');
  const lim = _req('src/account/loginLimiter.js');

  await t.test('after 30 failed attempts against different names the address is locked', async () => {
    const anfrage = { ip: IP, socket: {}, headers: {} };
    for (let i = 0; i < lim.MAX_JE_ADDRESS; i++) {
      const r = await checkCredentials(anfrage, `${NAME}_gibtsnicht_${i}`, 'falsch');
      assert.equal(r.absage?.art, 'nicht_angemeldet', `Versuch ${i + 1}`);
    }
    const r = await checkCredentials(anfrage, NAME, 'richtig-geheim');
    assert.equal(r.absage?.art, 'zu_viele');
  });

  await t.test('whoever has already logged in from here gets in despite the locked address', async () => {
    const anfrage = { ip: IP, socket: {}, headers: {} };
    await lim.loginSucceeded(IP, NAME);
    const r = await checkCredentials(anfrage, NAME, 'richtig-geheim');
    assert.equal(r.ok, true, `bekannt: trotz gesperrter Adresse angemeldet (${JSON.stringify(r.absage)})`);
    assert.equal(
      (await checkCredentials(anfrage, `${NAME}_gibtsnicht_x`, 'falsch')).absage?.art,
      'zu_viele',
      'ein anderer Name bleibt gesperrt',
    );
    for (let i = 0; i < lim.MAX_ATTEMPTS; i++) await checkCredentials(anfrage, NAME, 'falsch');
    assert.equal(
      (await checkCredentials(anfrage, NAME, 'richtig-geheim')).absage?.art,
      'zu_viele',
      'die Sperre je Adresse und Konto bleibt',
    );
  });

  await t.test('expired counters are deleted, fresh ones stay', async () => {
    await db.run(`INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES
      ('probe-alt|1', 3, NOW() - interval '3 days', NOW() - interval '2 days'),
      ('probe-neu|x', 1, NOW(), NOW())`);
    await lim.cleanLoginCounterOn();
    const da = (await db.all(`SELECT key FROM rate_limit_attempts WHERE key IN ('probe-alt|1','probe-neu|x')`)).map(
      z => z.key,
    );
    assert.deepEqual(da, ['probe-neu|x']);
  });
});
