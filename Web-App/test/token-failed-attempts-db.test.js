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
const bremse = _req('src/account/tokenFailedAttempts.js');
const loginAtInbox = (...a) =>
  _req('routes/api_v1/middleware.js')
    .guardFor(require('./helpers/sources').testServices().account)
    .loginAtInbox(...a);
const pgNotify = require('./helpers/sources').testAccess().notification;
const { bis } = require('./helpers/time');

const NAME = `fehlversuch_${process.pid}`;

test('failed attempts with unknown tokens', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const server = routerServer(_req, { t, sitzung: {}, routen: {} });
  server.app.use('/api/v1', loginAtInbox);
  server.app.get('/api/v1/probe', (_req2, res) => res.json({ ok: true }));
  // The cache only exists with a standing listen connection for revocations (fail closed).
  tokenCache.listenOnTokenRevocation();
  assert.ok(await bis(() => pgNotify.listensTo('token_widerrufen')), 'die Horch-Verbindung kam nicht zustande');
  t.after(async () => {
    await pgNotify.close();
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // What is counted is the token query on the connection, not a call in the source text.
  // In the pools of the app (runtime, system and web system role), not in the access of the test data.
  const zugang = require('./helpers/sources').testAccess();
  const pools = [...new Set([zugang.pool, zugang.systemPool, zugang.systemWebPool])];
  const echt = pools.map(p => p.query);
  let abfragen = 0;
  for (const [i, p] of pools.entries())
    p.query = (sql, ...rest) => {
      if (typeof sql === 'string' && /FROM api_tokens t JOIN users u/.test(sql)) abfragen++;
      return echt[i].call(p, sql, ...rest);
    };
  t.after(() => {
    for (const [i, p] of pools.entries()) p.query = echt[i];
  });

  const ruf = async token => {
    const r = await fetch(`${server.base}/api/v1/probe`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json() };
  };
  const zufall = i => `unbekannt-${process.pid}-${i}-${Math.random()}`;

  await t.test('up to the limit every unknown token checks the database', async () => {
    await bremse.forgetFailedAttempts();
    abfragen = 0;
    for (let i = 0; i < bremse.FAILED_ATTEMPT_MAX; i++) assert.equal((await ruf(zufall(i))).status, 401);
    assert.equal(abfragen, bremse.FAILED_ATTEMPT_MAX);
  });

  await t.test('a valid token in the cache is served even for a throttled address', async () => {
    await bremse.forgetFailedAttempts();
    const token = await auth.createToken(uid, 'Cache');
    assert.equal((await ruf(token)).status, 200, 'Vorbedingung: der Token gilt und steht im Cache');
    for (let i = 0; i < bremse.FAILED_ATTEMPT_MAX + 1; i++) await ruf(zufall(i));
    assert.equal((await ruf(token)).status, 200);
  });

  await t.test('after the limit an unknown token costs no database query', async () => {
    abfragen = 0;
    const r = await ruf(zufall('danach'));
    assert.equal(abfragen, 0);
    assert.equal(r.body.code, 'zu_viele_anfragen');
  });

  await t.test('the throttle responds 429, not 401', async () => {
    assert.equal((await ruf(zufall('noch'))).status, 429);
  });

  await t.test('after the window the address counts as clean again', async () => {
    const jetzt = Date.now() + bremse.FAILED_ATTEMPT_WINDOW_MS + 1000;
    assert.equal(bremse.toManyFailedAttempts('::1', jetzt), false);
    assert.equal(bremse.toManyFailedAttempts('127.0.0.1', jetzt), false);
  });

  await t.test('a reused token does not count as a failed attempt', async () => {
    await bremse.forgetFailedAttempts();
    const alt = await auth.createToken(uid, 'Alt', true);
    const neu = await auth.rotateToken(alt, null);
    assert.ok(neu && neu !== 'laeuft', 'Vorbedingung: der Tausch hat geklappt');
    assert.equal((await ruf(neu.token)).status, 200, 'der Nachfolger wird benutzt, der Vorgänger ist damit verbraucht');
    await db.run(`UPDATE api_tokens_consumed SET consumed_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [uid]);
    tokenCache.emptyTokenCache();
    for (let i = 0; i < bremse.FAILED_ATTEMPT_MAX; i++) await ruf(zufall(i));
    assert.equal((await ruf(alt)).status, 401);
    // If the family hit had been counted, the address would now be above the limit.
    assert.equal((await ruf(zufall('letzter'))).status, 401);
    assert.equal(
      (await db.all(`SELECT 1 FROM api_tokens WHERE user_id = $1 AND label = 'Alt'`, [uid])).length,
      0,
      'die Familie ist gesperrt',
    );
  });

  // A second process has its own memory but the same database.
  await t.test('a second web process counts the failed attempts of the first', async () => {
    await bremse.forgetFailedAttempts();
    for (let i = 0; i < bremse.FAILED_ATTEMPT_MAX; i++) assert.equal((await ruf(zufall(`a${i}`))).status, 401);
    bremse.forgetLockInProcess();
    abfragen = 0;
    assert.equal((await ruf(zufall('b1'))).status, 401, 'der erste Versuch im zweiten Prozess prüft noch');
    assert.equal((await ruf(zufall('b2'))).status, 429, 'danach gilt die gemeinsame Grenze');
    assert.equal(abfragen, 1);
    await bremse.forgetFailedAttempts();
  });
});
