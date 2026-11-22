/**
 * Concurrent exchanges of the same token: exactly one gets a new
 * token, the others 409 token_swap_running; the issued one applies. A second
 * exchange from another /24 network counts as a copy and ends the family.
 *
 * Counter-checks (measured 05.11.2026, each on its own):
 *   A  in rotateToken() the line `if (offen && offen.alter_s < SWAP_LOCK_S)`
 *      removed → red: “six concurrent exchanges …” (6× 200, only the
 *      last one applies)
 *   B  the branch for the other network removed → red: “a second exchange from
 *      another network …” (the old token kept exchanging)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('exchange of the same token', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `tausch_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v2',
    _req('routes/api/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${srv.address().port}`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const callFn = async (weg, token, method = 'GET') => {
    const r = await fetch(basis + '/api/v2' + weg, { method, headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  await t.test('six concurrent exchanges: one new, the others 409', async () => {
    const alt = await auth.createToken(uid, 'Telefon', true, null, { scope: 'app', ip: '127.0.0.1' });
    const antworten = await Promise.all(Array.from({ length: 6 }, () => callFn('/auth/rotate-token', alt, 'POST')));
    const state = JSON.stringify(antworten.map(a => [a.status, a.body?.code]));
    const neu = antworten.filter(a => a.status === 200);
    assert.equal(neu.length, 1, state);
    assert.ok(
      antworten.filter(a => a.status !== 200).every(a => a.status === 409 && a.body.code === 'token_swap_running'),
      state,
    );
    tokenCache.emptyTokenCache();
    assert.equal((await callFn('/stats', neu[0].body.token)).status, 200, 'the issued token is valid');
  });

  await t.test('a second exchange from another network ends the family', async () => {
    const alt = await auth.createToken(uid, 'Tablet', true, null, { scope: 'app', ip: '10.1.2.3' });
    const erster = await auth.rotateToken(alt, '10.1.2.77');
    assert.ok(erster && typeof erster === 'object', 'precondition: the first swap succeeds');
    await db.run(`UPDATE api_tokens SET rotated_at = NOW() - INTERVAL '1 minute' WHERE token = $1`, [
      auth.tokenDigest(erster.token),
    ]);
    assert.equal(await auth.rotateToken(alt, '192.0.2.5'), null);
    tokenCache.emptyTokenCache();
    assert.equal(await auth.userForToken(erster.token), null, 'the successor is gone');
    assert.equal(await auth.userForToken(alt), null, 'the old one is gone');
  });
});
