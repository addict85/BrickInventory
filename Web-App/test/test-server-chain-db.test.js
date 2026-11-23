/**
 * testServer (test/helpers/server.js) builds the app via buildApp like server.ts: what a
 * test checks there runs through the same middleware chain as in production, not through
 * rebuilt routers.
 *
 * Counter-checks (measured 13.11.2026, each on its own):
 *   A  `app.use(onlyOwnOrigin)` removed in startup/app.ts → red:
 *      “foreign origin with session cookie: 403” (200 instead of 403)
 *   B  testServer again with own routers (routerServer instead of buildApp) → red:
 *      all three cases (no CSP header, no refusal at the entrance, no foreign origin)
 *   C  the entrance lock (loginAtInbox) removed from apiInbox() in startup/app.ts
 *      → red: “an administrator without a second factor is rejected at the entrance”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');

test('testServer runs through the real chain', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `kette_echt_${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  const create = async (/** @type {string} */ n) =>
    (await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', true) RETURNING id`, [n])).id;
  const withIt = await create(NAME);
  const without = await create(`${NAME}_ohne`);
  await adminWithFactor(_req, withIt);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('security headers and request ID from grundschutz()', async () => {
    const { base } = testServer(_req, { session: {}, t });
    const r = await fetch(`${base}/api/v2/health/live`);
    assert.match(String(r.headers.get('content-security-policy')), /default-src 'self'/);
    assert.match(String(r.headers.get('x-request-id')), /\S/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  await t.test('foreign origin with session cookie: 403', async () => {
    const { base } = testServer(_req, { session: { userId: withIt, isAdmin: true }, t });
    const send = (/** @type {string} */ provenance) =>
      fetch(`${base}/api/v2/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'bim.sid=x', Origin: provenance },
        body: '{}',
      });
    const fremd = await send('https://boese.example');
    assert.equal(fremd.status, 403, 'foreign origin with a session cookie: 403');
    assert.equal((await fremd.json()).code, 'foreign_origin');
    assert.notEqual(
      (await (await send(base)).json().catch(() => ({}))).code,
      'foreign_origin',
      'the own origin gets through, otherwise the 403 above would prove nothing',
    );
  });

  await t.test('an administrator without a second factor is rejected at the entrance', async () => {
    const jobs = async (/** @type {number} */ id) =>
      fetch(`${testServer(_req, { session: { userId: id, isAdmin: true }, t }).base}/api/v2/admin/jobs`);
    const r = await jobs(without);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'second_factor_mandatory');
    assert.equal((await jobs(withIt)).status, 200, 'with a second factor it gets through');
  });
});
