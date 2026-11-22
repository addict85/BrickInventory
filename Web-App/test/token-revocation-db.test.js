/**
 * A token revocation takes effect immediately in the token cache of the web process, not
 * only after its period (5 s). The cache only applies as long as the listen
 * connection for foreign revocations stands; if it fails, every check asks
 * the database (fail closed).
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  `_tokenCache.clear()` removed in emptyTokenCache() → red: “the
 *      token administration clears the cache” and “a password change …”
 *   B  `_tokenCache.delete(token)` removed in tokenForgotten() → red:
 *      “logout applies immediately”
 *   C  (08.11.) TOKEN_TTL_MS again 60 s → red: “without notification a
 *      revoked token applies at most for the cache period” (token still applies after 6 s)
 *   D  (09.11.) in cacheUsable() (src/account/tokenCache.ts) only `return true` → red:
 *      “without a listen connection the cache does not apply” (token still applies after the drop)
 *   E  (09.11.) `_listens.clear()` removed in pgNotify.retire() → red: the same place
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const pgNotify = testAccess().notification;
const { bis } = require('./helpers/time');

test('token revocation applies immediately', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const name = `tw_${process.pid}`;
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
      [name],
    )
  ).id;
  t.after(async () => {
    await pgNotify.close();
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  tokenCache.listenOnTokenRevocation();
  assert.ok(await bis(() => pgNotify.listensTo('token_widerrufen')), 'the listen connection did not come about');
  /** A token that stands in the cache; afterwards its row is silently deleted. */
  const inCacheWithoutRow = async () => {
    const token = await auth.createToken(uid, 'Test');
    assert.ok(await auth.userForToken(token), 'precondition: the token is valid');
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    assert.ok(await auth.userForToken(token), 'counter-check: the cache still serves it');
    return token;
  };

  await t.test('logout applies immediately', async () => {
    const token = await inCacheWithoutRow();
    tokenCache.tokenForgotten(token);
    assert.equal(await auth.userForToken(token), null);
  });

  await t.test('the token administration clears the cache', async () => {
    const token = await inCacheWithoutRow();
    tokenCache.emptyTokenCache();
    assert.equal(await auth.userForToken(token), null);
  });

  await t.test('a password change also revokes cached tokens', async () => {
    const token = await auth.createToken(uid, 'Test');
    assert.ok(await auth.userForToken(token));
    await auth.revokeAllTokens(uid);
    assert.equal(await auth.userForToken(token), null);
  });

  await t.test('without notification a revoked token applies at most for the cache period', async t2 => {
    assert.ok(tokenCache.TOKEN_TTL_MS < 10_000, 'the period is below 10 s');
    const token = await inCacheWithoutRow();
    t2.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t2.mock.timers.tick(tokenCache.TOKEN_TTL_MS + 1000);
    assert.equal(await auth.userForToken(token), null);
  });

  await t.test('without a listen connection the cache does not apply', async () => {
    const token = await inCacheWithoutRow();
    // The connection drops, as with a restart of the database; until
    // reconnecting (1 s) a revocation from another process would not arrive.
    await db.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE 'LISTEN "token_widerrufen"%'`);
    assert.ok(await bis(() => !pgNotify.listensTo('token_widerrufen'), 2000), 'the teardown did not arrive');
    assert.equal(await auth.userForToken(token), null);
    assert.ok(await bis(() => pgNotify.listensTo('token_widerrufen'), 5000), 'the connection did not come back');
  });
});
