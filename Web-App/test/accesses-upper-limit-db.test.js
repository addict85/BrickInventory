/**
 * Logging in does not fill the tables arbitrarily (security review round 13, H2):
 * per account at most 50 sessions and 50 tokens, the one unused the longest
 * drops. Whoever logs in very often from one address only loses the
 * priority in the bcrypt barrier (soft limit), they are not locked out.
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  establishSession() without limitSessions() → red: “at most 50 sessions …”
 *   B  in capSessions() `ORDER BY expire ASC` → red: the same check (the
 *      most recently used ones dropped)
 *   C  createToken() without capTokens() → red: “at most 50 tokens …”
 *   D  capTokens() without `ersetzt_durch IS NULL` → red: the same check (the
 *      exchanged token in its overlap dropped)
 *   E  knownLogin() without the counter `login-erfolg` → red: “after 30
 *      logins …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);

test('upper limits for sessions, tokens and priority', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    noDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const NAME = `grenze_${process.pid}`,
    OTHER = `grenze_b_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, OTHER]]);
  const put = async n =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
        [n],
      )
    ).id;
  const uid = await put(NAME),
    otherOne = await put(OTHER);
  const sessions = id =>
    db.all(`SELECT sid FROM user_sessions WHERE sess::jsonb->>'userId' = $1 ORDER BY sid`, [String(id)]);
  t.after(async () => {
    await db.run(`DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = ANY($1)`, [[String(uid), String(otherOne)]]);
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [
      `%konto:${uid}%`,
      '%203.0.113.77%',
    ]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, otherOne]]);
    await db.pool.end().catch(() => {});
  });

  await t.test('at most 50 sessions per account, the most recently used stay', async () => {
    // 60 old sessions: alt_00 expired first (unused the longest), alt_59 last.
    for (const [id, n] of [
      [uid, 60],
      [otherOne, 3],
    ]) {
      for (let i = 0; i < n; i++) {
        await db.run(
          `INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
          [`${id}_alt_${String(i).padStart(2, '0')}`, JSON.stringify({ cookie: {}, userId: id }), 60 + i],
        );
      }
    }
    const establishSession = (...a) =>
      _req('src/account/http/login.js').establishSession(require('./helpers/sources').testServices().account, ...a);
    const app = express();
    app.use(
      session({
        store: _req('src/account/sessionStore.js').hashSessionIds(
          new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
        ),
        secret: 'grenze-test-geheimnis-lang-genug',
        resave: false,
        saveUninitialized: false,
      }),
    );
    app.post('/an', async (req, res) => {
      await establishSession(req, { userId: uid, username: NAME, isAdmin: false });
      res.json({ sid: req.sessionID });
    });
    const srv = app.listen(0);
    t.after(() => new Promise(r => srv.close(r)));
    const plain = (await (await fetch(`http://127.0.0.1:${srv.address().port}/an`, { method: 'POST' })).json()).sid;
    // The table holds the hash of the id (src/account/sessionStore.ts).
    const sid = _req('src/account/sessionStore.js').sessionDigest(plain);
    const rest = (await sessions(uid)).map(z => z.sid);
    assert.equal(rest.length, 50, 'at most 50 sessions …');
    assert.ok(rest.includes(sid), 'the new session stays');
    assert.deepEqual(
      rest.filter(s => s !== sid),
      Array.from({ length: 49 }, (_, i) => `${uid}_alt_${i + 11}`),
      'at most 50 sessions … (the longest unused ones are dropped)',
    );
    assert.equal((await sessions(otherOne)).length, 3, 'foreign sessions stay');
  });

  await t.test('at most 50 tokens per account, a swapped one does not count', async () => {
    for (let i = 0; i < 55; i++) {
      await db.run(
        `INSERT INTO api_tokens (token, user_id, label, last_used, expires_at)
        VALUES ($1, $2, 'alt', NOW() - make_interval(hours => $3), NOW() + INTERVAL '7 days')`,
        [`grenze_${uid}_${String(i).padStart(2, '0')}`, uid, 55 - i],
      );
    }
    // The oldest is already exchanged and still applies in its overlap.
    await db.run(`UPDATE api_tokens SET replaced_by = $2, last_used = NOW() - INTERVAL '100 hours' WHERE token = $1`, [
      `grenze_${uid}_00`,
      `grenze_${uid}_54`,
    ]);
    const auth = _req('src/account/deviceToken.js');
    const fresh = auth.tokenDigest(await auth.createToken(uid, 'neu'));
    const rest = (await db.all('SELECT token FROM api_tokens WHERE user_id = $1 ORDER BY token', [uid])).map(
      z => z.token,
    );
    assert.ok(rest.includes(fresh), 'the new token stays');
    assert.ok(rest.includes(`grenze_${uid}_00`), 'at most 50 tokens … (the rotated one stays until the overlap ends)');
    assert.deepEqual(
      rest.filter(x => x !== fresh && x !== `grenze_${uid}_00`),
      Array.from({ length: 49 }, (_, i) => `grenze_${uid}_${String(i + 6).padStart(2, '0')}`),
      'at most 50 tokens …',
    );
  });

  await t.test('after 30 logins per address and account only without priority', async () => {
    const L = _req('src/account/loginLimiter.js');
    const ip = '203.0.113.77';
    assert.equal(await L.knownLogin(ip, NAME), false, 'an unknown device has no priority');
    for (let i = 0; i < L.SUCCESSES_WITH_PRIORITY - 1; i++) await L.loginSucceeded(ip, NAME);
    assert.equal(await L.knownLogin(ip, NAME), true);
    await L.loginSucceeded(ip, NAME);
    assert.equal(await L.knownLogin(ip, NAME), false, 'after 30 sign-ins …');
    assert.equal(await L.loginAllowed(ip, NAME), null, 'the soft limit does not lock');
    await L.giveLoginSpaceFree(ip, NAME);
  });
});
