/**
 * The switches of an account (is_admin, is_active, email_verified) are
 * booleans (migration 0085, before 0/1) and never empty, and an e-mail address exists only once — regardless
 * of upper and lower case (migration 0069). The code already checked that
 * with LOWER(email); the database only knew the exact spelling.
 *
 * Counter-checks (measured on 29.10.2026, each on a fresh database):
 *   A  the block with users_email_lower removed from 0069 → red: “an address
 *      exists only once, regardless of spelling”
 *   B  (31.10.2026) is_admin not converted in 0085 → red: “without input the
 *      defaults apply” and “a switch is a boolean”
 *   C  `SET NOT NULL` removed for is_admin → red: “a switch is never empty”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('account switches and unique address', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const K = `schalter${process.pid}`;
  const leeren = () => db.run('DELETE FROM users WHERE username LIKE $1', [`${K}%`]);
  const put = (n, extra = '', values = []) =>
    db.get(
      `INSERT INTO users (username, password_hash${extra ? ', ' + extra : ''})
            VALUES ($1, 'x'${values.map((_, i) => `, $${i + 2}`).join('')}) RETURNING *`,
      [`${K}${n}`, ...values],
    );
  await leeren();

  try {
    await t.test('without a value the defaults apply', async () => {
      const u = await put('a');
      assert.deepEqual([u.is_admin, u.is_active, u.email_verified], [false, true, false]);
    });
    await t.test('a switch is never empty', async () => {
      await assert.rejects(put('b', 'is_admin', [null]), (/** @type {any} */ e) => e.code === '23502');
      await assert.rejects(put('c', 'is_active', [null]), (/** @type {any} */ e) => e.code === '23502');
    });
    await t.test('a switch is a boolean', async () => {
      await assert.rejects(put('d', 'is_admin', [2]), (/** @type {any} */ e) => e.code === '22P02');
      await assert.rejects(put('e', 'email_verified', [-1]), (/** @type {any} */ e) => e.code === '22P02');
    });
    await t.test('an address exists only once, regardless of case', async () => {
      await put('f', 'email', [`${K}@Beispiel.ch`]);
      await assert.rejects(
        put('g', 'email', [`${K.toUpperCase()}@beispiel.CH`]),
        (/** @type {any} */ e) => e.code === '23505',
      );
      assert.ok(await put('h', 'email', [null]));
      assert.ok(await put('i', 'email', [null]), 'without an address there may be several');
    });
  } finally {
    await leeren();
    await db.pool.end().catch(() => {});
  }
});
