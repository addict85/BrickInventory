/**
 * A set entry belongs to a stock row — the database checks it
 * (migration 0045), no longer only the three delete sites.
 *
 * Counter-checks (measured on 27.10.):
 *   A  the foreign key omitted in 0045 → red: “an entry without a
 *      stock row fails at COMMIT"
 *   B  the foreign key without DEFERRABLE → red: “within a transaction
 *      the entry may come before the stock"
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
const NAME = `erfbest_${process.pid}`,
  SET = '99074-1';

test('acquisition and inventory', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const erfassung = (tx, menge = 1) =>
    tx.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1, $2, $3, 'N')`, [
      uid,
      SET,
      menge,
    ]);

  await t.test('an acquisition without an inventory row fails at COMMIT', async () => {
    await assert.rejects(
      db.transaction(tx => erfassung(tx)),
      /set_acquisitions_holding_fkey/,
    );
    assert.equal((await db.get('SELECT count(*)::int AS n FROM set_acquisitions WHERE user_id = $1', [uid])).n, 0);
  });

  await t.test('within a transaction the acquisition may come before the inventory', async () => {
    await db.transaction(async tx => {
      await erfassung(tx);
      await tx.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SET]);
    });
    assert.equal((await db.get('SELECT count(*)::int AS n FROM set_acquisitions WHERE user_id = $1', [uid])).n, 1);
  });

  await t.test('quantity zero or unknown condition are rejected', async () => {
    await assert.rejects(
      db.transaction(tx => erfassung(tx, 0)),
      /set_acquisitions_quantity_positive/,
    );
    await assert.rejects(
      db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1, $2, 1, 'X')`, [
        uid,
        SET,
      ]),
      /set_acquisitions_condition/,
    );
  });

  await t.test('deleting the inventory while acquisitions exist fails', async () => {
    await assert.rejects(
      db.run('DELETE FROM sets WHERE user_id = $1 AND set_number = $2', [uid, SET]),
      /set_acquisitions_holding_fkey/,
    );
  });
});
