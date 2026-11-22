/**
 * transaction(): if the ROLLBACK fails, the original error arrives,
 * and the broken connection does not go back into the pool.
 *
 * Counter-checks (measured on 27.10.):
 *   A  again `await client.query('ROLLBACK')` without an own try and
 *      `client.release()` without an error → red: “the error from fn arrives,
 *      not the one from the ROLLBACK”
 *   B  `client.on('error', teardown)` removed → red: the 'error' event of the
 *      client stays without a listener and aborts the run („danach arbeitet
 *      der Pool weiter" is aborted)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

test('transaction() with a broken connection', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('the error from fn arrives, not the one from ROLLBACK', async () => {
    await assert.rejects(
      db.transaction(async tx => {
        // End the own connection: afterwards every ROLLBACK fails.
        await tx.get('SELECT pg_terminate_backend(pg_backend_pid())').catch(() => {});
        throw new Error('Ursprung');
      }),
      (/** @type {any} */ e) => e.message === 'Ursprung',
    );
  });

  await t.test('afterwards the pool keeps working', async () => {
    for (let i = 0; i < 12; i++) assert.equal((await db.get('SELECT 1 AS n')).n, 1);
  });
});
