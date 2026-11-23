/**
 * Passwords as argon2id (src/account/passwordHash.ts): new hashes are argon2id, a
 * bcrypt hash from the time before still applies and is replaced at the first successful
 * login, not at a failed one. Via the real route /login and the
 * runtime role (the hash is read and written in the system frame).
 *
 * Counter-checks (measured 14.11.2026, each on its own):
 *   A  in checkCredentials the replacing after needsNewHash deleted → red:
 *      “a bcrypt hash is replaced at login” ($2b$04$ stays)
 *   B  the replacing moved before the password check (also on a failed attempt) → red:
 *      “… a failed attempt replaces nothing” (the hash was argon2id afterwards)
 *   C  replacePasswordHash deleted from the system list in src/account/context.ts →
 *      red: “a bcrypt hash …” (permission denied for table users, 500)
 *   D  passwordFits only checks bcrypt → red: “new hashes are argon2id …” and
 *      “… afterwards with argon2id” (the second login 401)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const { ARGON2_PREFIX, hashPassword, passwordFits } = _req('src/account/passwordHash.js');

test('argon2id and replacing old bcrypt hashes', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `argon_${process.pid}`,
    PASS = 'Argon-Pruefung-2026-ä';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { t });
  const signIn = async password =>
    (
      await fetch(`${base}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: NAME, password: password, without_token: true }),
      })
    ).status;
  const saved = async () => (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash;

  await t.test('new hashes are argon2id with the fixed costs', async () => {
    const h = await hashPassword(PASS);
    assert.ok(h.startsWith(ARGON2_PREFIX), h.slice(0, 40));
    assert.equal(await passwordFits(PASS, h), true);
    assert.equal(await passwordFits(`${PASS}x`, h), false);
    // What stands behind byte 72 counts (bcrypt cut it off).
    const lang = 'L'.repeat(80);
    assert.equal(await passwordFits(`${lang}b`, await hashPassword(`${lang}a`)), false);
  });

  await t.test('… a failed attempt replaces nothing', async () => {
    assert.equal(await signIn('falsches-Passwort-1'), 401);
    assert.match(await saved(), /^\$2[aby]\$04\$/);
  });

  await t.test('a bcrypt hash is replaced at login, afterwards with argon2id', async () => {
    assert.equal(await signIn(PASS), 200);
    const fresh = await saved();
    assert.ok(fresh.startsWith(ARGON2_PREFIX), fresh.slice(0, 40));
    assert.equal(await signIn(PASS), 200);
    assert.equal(await saved(), fresh, 'a current hash stays');
  });
});
