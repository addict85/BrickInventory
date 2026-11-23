/**
 * The server proof for plaintext connections is dropped: the Android app
 * only accepts HTTPS in release. The path is no longer public (401
 * without login) and does not exist even when logged in (404).
 *
 * Counter-checks (measured 01.11.2026):
 *   A  `serverbeweis` back into the public paths of loginAtInbox
 *      → red: “without login 401” (404 instead of 401)
 *   B  a route POST /serverbeweis (response 400 like the old one on wrong
 *      input) back in routes/auth.ts → red: “logged in 404”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test('POST /api/v2/auth/serverbeweis no longer exists', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = req.get('x-probe-angemeldet') ? { userId: 1, mustChangePassword: false } : {};
    next();
  });
  app.use(
    '/api/v2',
    _req('routes/api/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const frage = (kopf = {}) =>
    fetch(`http://127.0.0.1:${srv.address().port}/api/v2/auth/serverbeweis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...kopf },
      body: JSON.stringify({ kennung: '0123456789abcdef', nonce: 'ab'.repeat(16) }),
    }).then(r => r.status);

  await t.test('without login 401', async () => assert.equal(await frage(), 401));
  await t.test('logged in 404', async () => assert.equal(await frage({ 'x-probe-angemeldet': '1' }), 404));
});
