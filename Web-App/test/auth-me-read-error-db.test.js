/**
 * GET /auth/me on a read error: 503 instead of “not logged in” or 401.
 * With 401 the app would discard its token, and the browser would show the
 * login mask although the session is valid. The error comes from the pool, as
 * with a broken connection; the rest runs for real.
 *
 * Counter-check (measured 11.11.2026): the former catch branch (token → 401
 * token_ungueltig, otherwise 200 loggedIn: false) → red in both subtests.
 * Counter-check (measured 16.11.2026): checkSessionVersion passes the read error on again as
 * next(e) → red: “with session …” (500 interner_fehler; the session version is no longer
 * cached without a listen connection, src/account/sessionVersion.ts).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');

test('/auth/me on a read error', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `me_lesefehler_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const token = await auth.createToken(uid, 'Lesefehler', false, null, { scope: 'app' });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t });
  const me = async (kopf = {}) => {
    const r = await fetch(`${base}/api/v1/auth/me`, { headers: kopf });
    return { status: r.status, body: await r.json() };
  };
  /** Every query fails while `work` runs. */
  const withError = async work => {
    // With an account the database layer takes its own connection (row security): both paths,
    // in all pools of the app (runtime, system and web system role).
    const zugang = require('./helpers/sources').testAccess();
    const pools = [...new Set([zugang.pool, zugang.systemPool, zugang.systemWebPool])];
    const echt = pools.map(p => ({ query: p.query, connect: p.connect }));
    const fehler = async () => {
      throw new Error('Verbindung zur Datenbank verloren');
    };
    for (const p of pools) Object.assign(p, { query: fehler, connect: fehler });
    try {
      return await work();
    } finally {
      for (const [i, p] of pools.entries()) Object.assign(p, echt[i]);
    }
  };

  await t.test('with session: 503 instead of "not logged in"', async () => {
    Object.assign(sitzung, { userId: uid, username: NAME });
    assert.equal((await me()).body.loggedIn, true, 'Vorbedingung: ohne Fehler angemeldet');
    const r = await withError(() => me());
    assert.deepEqual([r.status, r.body.code, r.body.loggedIn], [503, 'server_ausgelastet', undefined]);
    for (const k of Object.keys(sitzung)) delete sitzung[k];
  });

  await t.test('with token: 503 instead of 401', async () => {
    const kopf = { authorization: `Bearer ${token}` };
    assert.equal((await me(kopf)).body.loggedIn, true, 'Vorbedingung: ohne Fehler angemeldet');
    tokenCache.emptyTokenCache();
    const r = await withError(() => me(kopf));
    assert.deepEqual([r.status, r.body.code], [503, 'server_ausgelastet']);
  });
});
