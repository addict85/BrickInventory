/**
 * user_sessions holds only the SHA-256 of a session id, the cookie the plaintext
 * (src/account/sessionStore.ts). Whoever reads the table gets no usable cookie;
 * logout, "end other sessions" and the stream watch find
 * the row by the hash; migration 0125 hashes existing rows instead of signing out.
 *
 * Counter-checks (measured 22.11.2026, each on its own):
 *   A  hashSessionIds(sessionStorage) deleted in startup/app.ts → red: “the table
 *      holds the hash, not the id” and “a stolen row is no cookie”
 *   B  `destroy` left out in hashSessionIds() → red: “logout deletes the row”
 *      (the row stays and the cookie keeps applying)
 *   C  the WHERE condition deleted in migration 0125 → red: “the migration hashes
 *      old rows, once” (the second run hashes the hash)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testServices } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const bcrypt = require('bcryptjs');
const signature = require(path.join(__dirname, '..', 'node_modules', 'cookie-signature'));
const db = testData();

const SECRET = 'h'.repeat(48);
const { sessionDigest } = _req('src/account/sessionStore.js');
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '0125-session-ids-hashed.sql'),
  'utf8',
);

test('session ids are stored hashed', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `sitzhash_${process.pid}`,
    PASS = 'Sitzung-gehasht-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run(`DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1`, [String(uid)]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const services = testServices();
  const app = _req('startup/app.js').buildApp({
    pool: db.systemPool,
    config: _req('src/infra/config.js').config(),
    sessionSecret: SECRET,
    services: services,
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}`;
  const callFn = async (path, cookie, body) => {
    const r = await fetch(basis + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', origin: basis, ...(cookie ? { cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') };
  };
  const signIn = async () => {
    const r = await callFn('/api/v2/auth/login', null, { username: NAME, password: PASS, without_token: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return (r.cookie ?? '').split(';')[0];
  };
  const idFrom = cookie => signature.unsign(decodeURIComponent(cookie.split('=')[1]).slice(2), SECRET);
  const keks = sid => `bim.sid=${encodeURIComponent(`s:${signature.sign(sid, SECRET)}`)}`;
  const signedIn = async cookie => (await callFn('/api/v2/auth/me', cookie)).body?.loggedIn === true;
  const lines = async () =>
    (await db.all(`SELECT sid FROM user_sessions WHERE sess::jsonb->>'userId' = $1`, [String(uid)])).map(z => z.sid);

  await t.test('the table holds the hash, not the id', async () => {
    const cookie = await signIn();
    const sid = idFrom(cookie);
    assert.ok(sid, cookie);
    assert.ok(await signedIn(cookie));
    const da = await lines();
    assert.ok(da.includes(sessionDigest(sid)), 'the row carries the hash');
    assert.ok(!da.includes(sid), 'the row does not carry the ID from the cookie');
  });

  await t.test('a stolen row is no cookie', async () => {
    // Even with the secret: the stored value as id is hashed once more and found nowhere.
    const [stolen] = await lines();
    assert.equal(await signedIn(keks(stolen)), false);
  });

  await t.test('logout deletes the row', async () => {
    const cookie = await signIn();
    const prior = (await lines()).length;
    assert.equal((await callFn('/api/v2/auth/logout', cookie, {})).status, 200);
    assert.equal((await lines()).length, prior - 1);
    assert.ok(!(await lines()).includes(sessionDigest(idFrom(cookie))));
    assert.equal(await signedIn(cookie), false);
  });

  await t.test('end other sessions keeps the own one', async () => {
    const own = await signIn();
    const fremd = await signIn();
    const r = await callFn('/api/v2/settings/sessions/end-others', own, { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.deleted >= 1);
    assert.deepEqual(await lines(), [sessionDigest(idFrom(own))]);
    assert.ok(await signedIn(r.cookie ? r.cookie.split(';')[0] : own));
    assert.equal(await signedIn(fremd), false);
  });

  await t.test('the stream watch finds the session by the hash', async () => {
    const cookie = await signIn();
    const sid = idFrom(cookie);
    const { accessAppliesStill } = _req('src/account/http/accessWatch.js');
    const session = require(path.join(__dirname, '..', 'node_modules', 'express-session'));
    const pgSession = require(path.join(__dirname, '..', 'node_modules', 'connect-pg-simple'))(session);
    const store = _req('src/account/sessionStore.js').hashSessionIds(
      new pgSession({ pool: db.systemPool, tableName: 'user_sessions', createTableIfMissing: false }),
    );
    const sessionObj = (await db.get('SELECT sess FROM user_sessions WHERE sid = $1', [sessionDigest(sid)])).sess;
    const req = { session: sessionObj, sessionID: sid, sessionStore: store, headers: {} };
    assert.equal(await accessAppliesStill(services.account, req), true);
    await db.run('DELETE FROM user_sessions WHERE sid = $1', [sessionDigest(sid)]);
    assert.equal(await accessAppliesStill(services.account, req), false);
  });

  await t.test('the migration hashes old rows, once', async () => {
    // The session of a real login, stored under its plaintext id as before the update.
    const cookie = await signIn();
    const alt = idFrom(cookie);
    const { sess } = await db.get('SELECT sess FROM user_sessions WHERE sid = $1', [sessionDigest(alt)]);
    await db.run('DELETE FROM user_sessions WHERE sid = $1', [sessionDigest(alt)]);
    assert.equal(await signedIn(cookie), false);
    const c = await db.systemPool.connect();
    let fresh;
    try {
      await c.query('BEGIN');
      // A copy of the table in pg_temp: the migration must not touch the rows of parallel tests.
      await c.query('CREATE TEMP TABLE user_sessions (LIKE public.user_sessions INCLUDING ALL) ON COMMIT DROP');
      await c.query('SET LOCAL search_path = pg_temp, public');
      await c.query(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [
        alt,
        JSON.stringify(sess),
      ]);
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      fresh = (await c.query('SELECT sid FROM user_sessions')).rows.map(z => z.sid);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    assert.deepEqual(fresh, [sessionDigest(alt)]);
    await db.run(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [
      fresh[0],
      JSON.stringify(sess),
    ]);
    assert.equal(await signedIn(cookie), true, 'the old cookie stays valid after the update');
  });
});
