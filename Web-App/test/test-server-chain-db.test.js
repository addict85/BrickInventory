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
  const anlegen = async (/** @type {string} */ n) =>
    (await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', true) RETURNING id`, [n])).id;
  const mit = await anlegen(NAME);
  const ohne = await anlegen(`${NAME}_ohne`);
  await adminWithFactor(_req, mit);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('security headers and request ID from grundschutz()', async () => {
    const { base } = testServer(_req, { sitzung: {}, t });
    const r = await fetch(`${base}/api/v1/health/live`);
    assert.match(String(r.headers.get('content-security-policy')), /default-src 'self'/);
    assert.match(String(r.headers.get('x-request-id')), /\S/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  await t.test('foreign origin with session cookie: 403', async () => {
    const { base } = testServer(_req, { sitzung: { userId: mit, isAdmin: true }, t });
    const sende = (/** @type {string} */ herkunft) =>
      fetch(`${base}/api/v1/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'bim.sid=x', Origin: herkunft },
        body: '{}',
      });
    const fremd = await sende('https://boese.example');
    assert.equal(fremd.status, 403, 'fremde Herkunft mit Sitzungskeks: 403');
    assert.equal((await fremd.json()).code, 'fremde_herkunft');
    assert.notEqual(
      (await (await sende(base)).json().catch(() => ({}))).code,
      'fremde_herkunft',
      'die eigene Herkunft kommt durch, sonst bewiese die 403 oben nichts',
    );
  });

  await t.test('an administrator without a second factor is rejected at the entrance', async () => {
    const jobs = async (/** @type {number} */ id) =>
      fetch(`${testServer(_req, { sitzung: { userId: id, isAdmin: true }, t }).base}/api/v1/admin/jobs`);
    const r = await jobs(ohne);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'zweiter_faktor_pflicht');
    assert.equal((await jobs(mit)).status, 200, 'mit zweitem Faktor kommt er durch');
  });
});
