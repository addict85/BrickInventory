/**
 * The account switches go out as true/false, as they are stored in the database
 * since migration 0085: is_admin in the administration's account list,
 * email_verified in the own profile (API version 2). Checked on the routes
 * so that the contract (src/contract/) runs along.
 *
 * Counter-checks (31.10.2026, measured):
 *   a) in accountsList() back to `is_admin: k.is_admin ? 1 : 0` → red: “the
 *      administration's account list” (1 instead of true; the contract reports 500)
 *   b) in profil() back to `email_verified: p.email_verified ? 1 : 0` → red:
 *      “the own profile”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');

test('account switches go out as true/false', async t => {
  const db = testData();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const n = `schalterzahl${process.pid}`;
  const chef = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`,
      [`${n}a`],
    )
  ).id;
  const gast = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${n}b`]))
    .id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[chef, gast]]);
    await db.pool.end();
  });
  await adminWithFactor(_req, chef);
  let als = chef;
  const sitzung = {};
  Object.defineProperty(sitzung, 'userId', { get: () => als, enumerable: true });
  Object.defineProperty(sitzung, 'isAdmin', { get: () => als === chef, enumerable: true });
  const { base } = testServer(_req, { sitzung, t });
  const hole = async path => {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };

  await t.test('the admin account list', async () => {
    als = chef;
    const liste = (await hole('/api/v2/auth/users')).users.filter(k => k.id === chef || k.id === gast);
    assert.deepEqual(
      liste.map(k => [k.id, k.is_admin]),
      [
        [chef, true],
        [gast, false],
      ],
    );
  });
  await t.test('the own profile', async () => {
    als = chef;
    assert.equal((await hole('/api/v2/auth/profile')).user.email_verified, true);
    als = gast;
    assert.equal((await hole('/api/v2/auth/profile')).user.email_verified, false);
  });
});
