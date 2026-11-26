/**
 * No password confirmation in a running session (docs/SICHERHEIT.md): the session
 * mints a device token without one, but a token cannot multiply itself.
 *
 * Counter-checks:
 *   B  (27.10.) the session condition removed in token-create → red: “a token mints
 *      no further one”
 *   C  (26.11.2026) a password check back into token-create → red: “from the
 *      session without a password” (400 instead of 200)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `pwbest_${process.pid}`,
  PASS = 'Passwort12345';

test('device tokens from the session', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
     VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const withSession = testServer(_req, { session: { userId: uid, username: NAME }, t });
  const withoutSession = testServer(_req, { session: {}, t });
  const post = async (srv, path, body, head = {}) => {
    const r = await fetch(`${srv.base}${AUTH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...head },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('a token mints no further one', async () => {
    const token = await _req('src/account/deviceToken.js').createToken(uid, 'Probe');
    const r = await post(withoutSession, '/token-create', {}, { Authorization: `Bearer ${token}` });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'session_only');
  });

  await t.test('from the session without a password', async () => {
    const r = await post(withSession, '/token-create', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token);
  });
});
