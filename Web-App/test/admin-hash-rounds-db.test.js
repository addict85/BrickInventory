/**
 * The administrator account created at first start has the same hash cost
 * as every other password. With less, a failed attempt against
 * “admin” answered measurably faster than against an unknown name.
 *
 * Counter-check (measured on 28.10.2026; since 09.11. in src/account/startAdmin.ts): back to
 * `hashSync(plainPassword, 10)` → red (10 instead of 12).
 * Counter-check (14.11.2026, argon2id): in hashPasswordImmediately `timeCost: 1` → red
 * (prefix with t=1 instead of t=2).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (the schema is recreated).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
delete process.env.ADMIN_PASSWORD;

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

test('admin account with the same number of rounds', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  t.after(() => db.pool.end().catch(() => {}));
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  const echt = console.log;
  console.log = () => {};
  try {
    await db.initSchema();
  } finally {
    console.log = echt;
  }
  const admin = await db.get("SELECT password_hash FROM users WHERE username = 'admin'");
  assert.ok(admin, 'no admin account created');
  const { ARGON2_PREFIX } = _req('src/account/passwordHash.js');
  assert.ok(admin.password_hash.startsWith(ARGON2_PREFIX), admin.password_hash.slice(0, 40));
});
