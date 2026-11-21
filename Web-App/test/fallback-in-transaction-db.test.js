/**
 * In a transaction there is no substitute value: after a database error
 * PostgreSQL accepts no further command (25P02), a substitute would hide the
 * cause. The error is forced with an overflow: two entries of
 * two billion each blow the `::int` of the quantity sum.
 *
 * Counter-checks (measured 10.11.2026):
 * - erfassungen.ts: mengeDesBestands again with `.catch(reportAndDeliver(…, null))`
 *   AND in db/transaction.ts (newTxStatus) `verdirbt: () => false` → red: “the cause arrives”
 *   (25P02 instead of 22003, the cleanup ran into the dead transaction).
 *   Only the old catch, guard active → green: the guard alone carries.
 * - fehler.ts: in checkFallbackInTransaction the first line replaced by `return;`
 *   → red: “a database error goes on” and “outside the
 *   database it throws in tests”.
 * - db/transaction.ts: `fromSavepointCaught.add(e)` removed → red:
 *   “behind a savepoint the substitute applies”.
 * - db/database.ts: in oneTimeTransaction `streng: false` instead of `streng: r.streng` → red:
 *   “outside the database it throws in tests”.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet, record, haltRow } = require('./helpers/inventory');
const db = testData();
const { reportAndDeliver, logAndContinue } = _req('src/infra/error.js');
const { versuche } = _req('src/infra/result.js');
const { deleteAcquisition } = _req('src/collection/acquisitions.js');

const NAME = `ersatz_tx_${process.pid}`,
  SET = '71999-1';
/** @param {string} c */
const withCode = c => (/** @type {any} */ e) => e.code === c;

test('no substitute value in a transaction', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('a database error propagates', async () => {
    await assert.rejects(
      db.transaction(async tx => tx.get('SELECT 1/0 AS x').catch(reportAndDeliver('probe', null))),
      withCode('22012'),
    );
    await assert.rejects(
      db.transaction(async tx => {
        await tx.get('SELECT 1/0 AS x').catch(logAndContinue('probe'));
      }),
      withCode('22012'),
    );
    await assert.rejects(
      db.transaction(async tx => versuche('probe', tx.get('SELECT 1/0 AS x'))),
      withCode('22012'),
    );
  });

  await t.test('outside the database it throws in tests', async () => {
    await assert.rejects(
      db.transaction(async () => Promise.reject(new Error('Netz weg')).catch(reportAndDeliver('probe', 7))),
      /Ersatzwert in einer Transaktion \(probe\): Netz weg/,
    );
  });

  await t.test('outside a transaction the substitute applies', async () => {
    assert.equal(await db.get('SELECT 1/0 AS x').catch(reportAndDeliver('probe', 'ersatz')), 'ersatz');
  });

  await t.test('behind a savepoint the substitute applies', async () => {
    const r = await db.transaction(async tx => {
      // The savepoint via the transaction's access.
      const ersatz = await tx.db
        .transaction(inner => inner.get('SELECT 1/0 AS x'))
        .catch(reportAndDeliver('probe', 'ersatz'));
      // The outer transaction still accepts commands afterwards.
      return [ersatz, (await tx.get('SELECT 2 AS z')).z];
    });
    assert.deepEqual(r, ['ersatz', 2]);
  });

  await t.test('the cause arrives, nothing is cleaned up', async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    const uid = (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`,
        [NAME],
      )
    ).id;
    t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
    await holdsSet(db, uid, SET, 1);
    await record(db, uid, SET, 2_000_000_000, { am: '2026-01-02T12:00:00Z' });
    await record(db, uid, SET, 2_000_000_000, { am: '2026-01-03T12:00:00Z' });
    const klein = (await db.get('SELECT id FROM set_acquisitions WHERE user_id = $1 AND quantity = 1', [uid])).id;

    await assert.rejects(deleteAcquisition('set', uid, klein, [SET]), (/** @type {any} */ e) => {
      assert.equal(e.code, '22003', `statt der Ursache kam ${e.code}: ${e.message}`);
      return true;
    });
    assert.ok(await haltRow(db, uid, SET), 'Die Bestandszeile ist weg');
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id = $1', [uid])).n, 3);
  });
});
