/**
 * The idempotency middleware answers from storage before the route checks its
 * administrator guard (requireApiAdmin). A stored administrator response
 * must therefore not be delivered to an app token of the same account.
 * Checked on the real chain in front of /api/v1 (apiInbox) with real tokens.
 *
 * Counter-check (measured 13.11.2026):
 *   A  in middleware.ts the role not passed to fingerprint() → red:
 *      “an app token does not get the administrator response” (200 with
 *      Idempotent-Replay instead of 422)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');

test('idempotency: admin responses only for the admin role', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const name = `idem_rolle_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified, is_admin)
       VALUES ($1, 'x', true, true, true) RETURNING id`,
      [name],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
  await adminWithFactor(_req, uid);
  const appToken = await _req('src/account/deviceToken.js').createToken(uid, 'Rollen-Probe', false, null, {
    scope: 'app',
  });

  const session = { userId: uid, username: name, isAdmin: true, mustChangePassword: false };
  const admin = testServer(_req, { session, t });
  const without = testServer(_req, { session: {}, t });

  const key = `rolle-${process.pid}-${Date.now()}`;
  const sendIt = (base, head = {}) =>
    fetch(`${base}/api/v2/admin/default-condition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...head },
      body: JSON.stringify({ condition: 'U' }),
    });

  const erst = await sendIt(admin.base);
  assert.equal(erst.status, 200, 'the admin request itself goes through');
  assert.equal((await erst.json()).condition, 'U');

  const again = await sendIt(admin.base);
  assert.equal(again.headers.get('idempotent-replay'), 'true', 'the same role gets the replay');

  const app = await sendIt(without.base, { Authorization: `Bearer ${appToken}` });
  assert.notEqual(app.headers.get('idempotent-replay'), 'true', 'an app token does not get the admin response');
  assert.equal(app.status, 422, 'an app token does not get the admin response');
  assert.equal((await app.json()).code, 'idempotency_key_mismatch');
});
