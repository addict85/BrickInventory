/**
 * The label of a token from the login is limited (100 characters) and
 * always text. Before, /login stored every label untruncated in api_tokens.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in /login again `label || 'webapp-session'` → red: 1, 2 and 3 (the
 *      label arrived untruncated, the object not as the default)
 *   B  truncating by UTF-16 units instead of by characters → red: “3. …” (a
 *      half emoji at the end)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = einhaengung('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `label_${process.pid}`,
  PASS = 'label-Passwort-1';

test('token label at login', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, false, true, true) RETURNING id`,
      [NAME, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`%${uid}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));

  /** Log in and read the label of the token just issued. */
  const labelNach = async label => {
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    const r = await fetch(`http://localhost:${srv.address().port}${AUTH}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, label }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.ok(body.token, 'kein Token ausgestellt');
    return (await db.get('SELECT label FROM api_tokens WHERE user_id = $1', [uid])).label;
  };

  await t.test('1. a long label is shortened to 100 characters', async () => {
    const gespeichert = await labelNach('Pixel ' + 'x'.repeat(5000));
    assert.equal(gespeichert.length, 100, `${gespeichert.length} Zeichen gespeichert`);
    assert.ok(gespeichert.startsWith('Pixel x'));
    assert.equal(await labelNach('  Galaxy S24  '), 'Galaxy S24', 'ein kurzes bleibt, nur getrimmt');
  });

  await t.test('2. non-text and empty fall back to the default', async () => {
    assert.equal(await labelNach({ name: 'x'.repeat(500) }), 'webapp-session');
    assert.equal(await labelNach(['a', 'b']), 'webapp-session');
    assert.equal(await labelNach('   '), 'webapp-session');
  });

  await t.test('3. shortening goes by characters, not in the middle of one', async () => {
    const gespeichert = await labelNach('🧱'.repeat(150));
    assert.equal(Array.from(gespeichert).length, 100);
    assert.equal(gespeichert, '🧱'.repeat(100));
  });
});
