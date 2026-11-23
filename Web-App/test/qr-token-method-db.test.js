/**
 * The QR nonce is created via POST, not via GET.
 *
 * The nonce opens an account for five minutes. Via GET with a session cookie
 * a foreign site could trigger it despite SameSite=lax (navigation), and
 * link previews would do it on the side. Both directions are checked: POST works,
 * GET no longer exists.
 *
 * ── Counter-check (carried out) ───────────────────────────────────────────────
 * The route tentatively set back to `router.get`: “via GET the route no
 * longer exists” turns red (200 instead of 404), and “via POST a
 * nonce is created” turns red as well. Rebuilt, green again.
 *
 * Prerequisite: test DB (contents are cleared!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Since the QR code carries the address of the server (src/infra/baseUrl.ts),
// APP_BASE_URL is a PRECONDITION of the route: without it it refuses with 503,
// so that no code goes out with the browser address. This file checks something
// else — here the precondition is only fulfilled, not checked. That is done by
// test/qr-address.test.js.
process.env.APP_BASE_URL = 'https://lego.example.org';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
// Read the address from server.ts — see einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

let _srv, _base, _uid;
test('QR nonce only via POST', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }
  const bcrypt = require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs'));
  await db.run("INSERT INTO users (username, password_hash) VALUES ('qr', $1)", [
    await bcrypt.hash('qr-passwort-1', 4),
  ]);
  _uid = (await db.get("SELECT id FROM users WHERE username='qr'")).id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: _uid };
    next();
  });
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  _srv = app.listen(0);
  _base = `http://localhost:${_srv.address().port}`;

  const callFn = async method => {
    const r = await fetch(`${_base}${AUTH}/qr-token`, {
      method: method,
      redirect: 'manual',
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'qr-passwort-1' }) }
        : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const nonces = async () =>
    Number((await db.get('SELECT COUNT(*)::int AS n FROM qr_login_tokens').catch(() => ({ n: 0 }))).n);

  await t.test('via POST a nonce is created', async () => {
    const prior = await nonces();
    const r = await callFn('POST');
    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    assert.equal(r.body?.success, true);
    assert.match(String(r.body?.token), /^bim:/, 'The token does not carry the expected prefix');
    assert.equal(await nonces(), prior + 1, 'No nonce was created');
  });

  await t.test('via GET the route no longer exists', async () => {
    const prior = await nonces();
    const r = await callFn('GET');
    assert.notEqual(
      r.status,
      200,
      'GET ' +
        AUTH +
        '/qr-token answers with 200 again — that brings back the ' +
        'SameSite=lax gap from an earlier round: a navigation from a ' +
        'foreign page then creates a login nonce again.',
    );
    assert.equal(await nonces(), prior, 'A GET created something anyway');
  });

  _srv?.close();
  await db.pool.end().catch(() => {});
});
