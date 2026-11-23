/**
 * Every web process holds its own token cache (60 s). A
 * revocation in one process announces itself via NOTIFY, the others clear their
 * cache immediately — a revoked token does not keep applying there for up to a minute.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  the pgNotify.listen() removed in listenOnTokenRevocation() → red: “a
 *      revocation from another process applies immediately”
 *   B  reportRevocation() removed in emptyTokenCache() → red: “a revocation here
 *      notifies the others”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const pgNotify = testAccess().notification;
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

test('token revocation across all processes', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `widerruf_p_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  // The „other process“: an own connection that deletes, notifies and listens along.
  const otherOne = new Client({ connectionString: process.env.DATABASE_URL });
  await otherOne.connect();
  t.after(async () => {
    await pgNotify.close();
    await otherOne.end().catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  tokenCache.listenOnTokenRevocation();
  // Once the listen connection stands, it clears the store once; that must not
  // fall into the middle of the first case. An own listener reports when that is the case.
  let ready = false;
  const done = () => {
    ready = true;
  };
  pgNotify.listen('token_widerrufen', done);
  for (let i = 0; i < 200 && !ready; i++) await new Promise(r => setTimeout(r, 25));
  pgNotify.unlisten('token_widerrufen', done);
  assert.ok(ready, 'the listen connection did not come about');

  await t.test('a revocation from another process applies immediately', async () => {
    const token = await auth.createToken(uid, 'Probe', true);
    assert.ok((await auth.checkToken(token)).user, 'precondition: the token is valid');
    await otherOne.query('DELETE FROM api_tokens WHERE token = $1', [auth.tokenDigest(token)]);
    assert.ok((await auth.checkToken(token)).user, 'precondition: the cache still holds it');
    let applies = true;
    for (let i = 0; i < 40 && applies; i++) {
      await otherOne.query("SELECT pg_notify('token_widerrufen', '')");
      await new Promise(r => setTimeout(r, 50));
      applies = !!(await auth.checkToken(token)).user;
    }
    assert.equal(applies, false, 'the revoked token stays valid in the cache');
  });

  await t.test('a revocation here notifies the others', async () => {
    const belongsTo = [];
    otherOne.on('notification', m => belongsTo.push(m.channel));
    await otherOne.query('LISTEN token_widerrufen');
    await auth.revokeAllTokens(uid);
    for (let i = 0; i < 40 && !belongsTo.length; i++) await new Promise(r => setTimeout(r, 25));
    assert.deepEqual(belongsTo.slice(0, 1), ['token_widerrufen']);
  });
});
