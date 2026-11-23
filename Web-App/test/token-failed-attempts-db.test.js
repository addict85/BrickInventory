/**
 * An address that constantly presents unknown bearer tokens is throttled
 * without valid accesses or the reuse detection suffering.
 * Measured at the entrance (loginAtInbox) and repository calls.
 *
 * Counter-checks (measured on 08.11.2026, each on its own):
 *   A  the line with toManyFailedAttempts() removed in checkToken() → red:
 *      “after the limit an unknown token costs no database query”
 *      and “the throttle responds 429, not 401”
 *   B  in checkToken() countFailedAttempt() also for tokens from a family
 *      (return value of reportReuse ignored) → red: “a
 *      reused token does not count as a failed attempt”
 *   C  in sendTokenRejection() always 401 → red: “the throttle responds 429,
 *      not 401”
 *   D  the cache check put behind the throttle → red: “a valid
 *      token in the cache is served even for a throttled address”
 *   E  (08.11.) in countFailedAttempt() counted in the process again (a map
 *      that forgetLockInProcess() clears too) instead of via countRequest() →
 *      red: “a second web process counts the failed attempts of the first”
 *      (401 instead of 429)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');
const db = require('./helpers/sources').testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const brake = _req('src/account/tokenFailedAttempts.js');
const loginAtInbox = (...a) =>
  _req('routes/api/middleware.js')
    .guardFor(require('./helpers/sources').testServices().account)
    .loginAtInbox(...a);
const pgNotify = require('./helpers/sources').testAccess().notification;
const { until } = require('./helpers/time');

const NAME = `fehlversuch_${process.pid}`;

test('failed attempts with unknown tokens', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const server = routerServer(_req, { t, session: {}, routes: {} });
  server.app.use('/api/v2', loginAtInbox);
  server.app.get('/api/v2/probe', (_req2, res) => res.json({ ok: true }));
  // The cache only exists with a standing listen connection for revocations (fail closed).
  tokenCache.listenOnTokenRevocation();
  assert.ok(await until(() => pgNotify.listensTo('token_widerrufen')), 'the listen connection did not come about');
  t.after(async () => {
    await pgNotify.close();
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // What is counted is the token query on the connection, not a call in the source text.
  // In the pools of the app (runtime, system and web system role), not in the access of the test data.
  const access = require('./helpers/sources').testAccess();
  const pools = [...new Set([access.pool, access.systemPool, access.systemWebPool])];
  const original = pools.map(p => p.query);
  let queryList = 0;
  for (const [i, p] of pools.entries())
    p.query = (sql, ...rest) => {
      if (typeof sql === 'string' && /FROM api_tokens t JOIN users u/.test(sql)) queryList++;
      return original[i].call(p, sql, ...rest);
    };
  t.after(() => {
    for (const [i, p] of pools.entries()) p.query = original[i];
  });

  const callFn = async token => {
    const r = await fetch(`${server.base}/api/v2/probe`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json() };
  };
  const randomValue = i => `unbekannt-${process.pid}-${i}-${Math.random()}`;

  await t.test('up to the limit every unknown token checks the database', async () => {
    await brake.forgetFailedAttempts();
    queryList = 0;
    for (let i = 0; i < brake.FAILED_ATTEMPT_MAX; i++) assert.equal((await callFn(randomValue(i))).status, 401);
    assert.equal(queryList, brake.FAILED_ATTEMPT_MAX);
  });

  await t.test('a valid token in the cache is served even for a throttled address', async () => {
    await brake.forgetFailedAttempts();
    const token = await auth.createToken(uid, 'Cache');
    assert.equal((await callFn(token)).status, 200, 'precondition: the token is valid and in the cache');
    for (let i = 0; i < brake.FAILED_ATTEMPT_MAX + 1; i++) await callFn(randomValue(i));
    assert.equal((await callFn(token)).status, 200);
  });

  await t.test('after the limit an unknown token costs no database query', async () => {
    queryList = 0;
    const r = await callFn(randomValue('danach'));
    assert.equal(queryList, 0);
    assert.equal(r.body.code, 'too_many_requests');
  });

  await t.test('the throttle responds 429, not 401', async () => {
    assert.equal((await callFn(randomValue('noch'))).status, 429);
  });

  await t.test('after the window the address counts as clean again', async () => {
    const now = Date.now() + brake.FAILED_ATTEMPT_WINDOW_MS + 1000;
    assert.equal(brake.toManyFailedAttempts('::1', now), false);
    assert.equal(brake.toManyFailedAttempts('127.0.0.1', now), false);
  });

  await t.test('a reused token does not count as a failed attempt', async () => {
    await brake.forgetFailedAttempts();
    const alt = await auth.createToken(uid, 'Alt', true);
    const fresh = await auth.rotateToken(alt, null);
    assert.ok(fresh && fresh !== 'laeuft', 'precondition: the swap worked');
    assert.equal((await callFn(fresh.token)).status, 200, 'the successor is used, so the predecessor is spent');
    await db.run(`UPDATE api_tokens_consumed SET consumed_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [uid]);
    tokenCache.emptyTokenCache();
    for (let i = 0; i < brake.FAILED_ATTEMPT_MAX; i++) await callFn(randomValue(i));
    assert.equal((await callFn(alt)).status, 401);
    // If the family hit had been counted, the address would now be above the limit.
    assert.equal((await callFn(randomValue('letzter'))).status, 401);
    assert.equal(
      (await db.all(`SELECT 1 FROM api_tokens WHERE user_id = $1 AND label = 'Alt'`, [uid])).length,
      0,
      'the family is locked',
    );
  });

  // A second process has its own memory but the same database.
  await t.test('a second web process counts the failed attempts of the first', async () => {
    await brake.forgetFailedAttempts();
    for (let i = 0; i < brake.FAILED_ATTEMPT_MAX; i++) assert.equal((await callFn(randomValue(`a${i}`))).status, 401);
    brake.forgetLockInProcess();
    queryList = 0;
    assert.equal((await callFn(randomValue('b1'))).status, 401, 'the first attempt in the second process still checks');
    assert.equal((await callFn(randomValue('b2'))).status, 429, 'after that the shared limit applies');
    assert.equal(queryList, 1);
    await brake.forgetFailedAttempts();
  });
});
