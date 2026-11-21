/**
 * The „known login“ remembered for 30 days stores no plaintext address in
 * rate_limit_attempts, and the precedence of known logins still works.
 *
 * Counter-checks (measured on 08.11.2026):
 *   A  _knownKey and _successKey again take drosselAdresse(ip) instead of the
 *      fingerprint → red: “no plaintext address”
 *   B  adressDigest delivers a different value per call → red: “known
 *      stays known”
 *   C  adressDigest delivers the same value for every address → red: “a different
 *      address is unknown”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const limiter = _req('src/account/loginLimiter.js');

test('known login: address only stored as a fingerprint', { concurrency: 1 }, async t => {
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

  await limiter.loginSucceeded(IP, name);
  await limiter.loginSucceeded(IP6, name);

  await t.test('no plaintext address', async () => {
    const zeilen = await db.all(
      `SELECT key FROM rate_limit_attempts WHERE key LIKE 'login-bekannt|%' OR key LIKE 'login-erfolg|%'`,
    );
    const meine = zeilen.filter(z => z.key.endsWith(`|konto:${uid}`));
    assert.equal(meine.length, 4, 'je Adresse eine Bekannt- und eine Erfolgszeile');
    for (const { key } of meine) {
      assert.ok(!key.includes('203.0.113') && !key.includes('2001:db8'), `Klartext in ${key}`);
    }
  });

  await t.test('known stays known', async () => {
    assert.equal(await limiter.knownLogin(IP, name), true);
    assert.equal(await limiter.knownLogin(IP6, name), true);
    // The same /64 counts as the same address.
    assert.equal(await limiter.knownLogin('2001:db8:1:2:ffff::1', name), true);
  });

  await t.test('a different address is unknown', async () => {
    assert.equal(await limiter.knownLogin('203.0.113.78', name), false);
  });
});
