/**
 * A transaction is passed explicitly: a set of services over its access
 * (`ueber(tx.db)`, as the context `t` builds it) reads and writes via its
 * connection; the same service over the unbound access throws inside it
 * (UnboundQuery). An inner transaction is a savepoint, and whoever
 * still asks after COMMIT gets the pool.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  the query of txClient() deleted in all() → red: “a service without
 *      tx parameter sees what the transaction wrote”
 *   B  transaction() without a savepoint (the inner one runs on its own
 *      connection) → red: “a failed inner transaction …”, the
 *      inner one does not see the state of the outer one
 *   B2 ROLLBACK TO SAVEPOINT deleted → red: the same check, the
 *      row of the inner one stays
 *   C  `stand.offen = false` after COMMIT deleted → red: “whoever asks after COMMIT
 *      gets the pool”
 *   D  (14.11.2026) the release not checked in txStand() → red: “a service without
 *      tx parameter … without release it throws”
 *   Since the context `t` is built via tx.db (14.11.2026, w5-vertrag), measured:
 *   E  wache() emptied in database.ts → red: “… on the unbound access it throws”
 *   F  in umbau() (src/infra/area.ts) the access not replaced (`aus.db = db` deleted)
 *      → red: the same check and “a failed inner transaction …” (the set over
 *      tx.db asks via the unbound access)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');

test('transaction in the call path', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const S = `tx_umgebung_${process.pid}`;
  // Only the system role writes global_settings (0117): the transactions run in its context.
  const { inSystemContext } = _req('src/infra/accountContext.js');
  const transaction = fn => inSystemContext('test', () => db.transaction(fn));
  t.after(async () => {
    await inSystemContext('test', () => db.run('DELETE FROM global_settings WHERE key LIKE $1', [`${S}%`])).catch(
      () => {},
    );
    await db.pool.end().catch(() => {});
  });
  const { getGlobalSetting } = _req('src/settings/settings.js');
  const settings = require('./helpers/sources').testServices().settings;
  /** The settings over the access of a transaction, as they stand in `t`. */
  const in_ = tx => settings.over(tx.db);
  const write = (tx, k, v) => tx.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [`${S}${k}`, v]);

  await t.test('a service via tx.db sees what the transaction wrote; on the unbound access it throws', async () => {
    let seen;
    await assert.rejects(
      transaction(async tx => {
        await write(tx, 'a', 'eins');
        await assert.rejects(getGlobalSetting(`${S}a`), { name: 'Error', message: /ungebundenen Zugang/ });
        seen = await in_(tx).globalValue(`${S}a`);
        throw new Error('zurück');
      }),
      /zurück/,
    );
    assert.equal(seen, 'eins');
    assert.equal(await getGlobalSetting(`${S}a`), null, 'rolled back with the transaction');
  });

  await t.test('a failed inner transaction lets the outer one continue', async () => {
    await transaction(async tx => {
      await write(tx, 'b', 'aussen');
      await assert.rejects(
        tx.db.transaction(async inner => {
          assert.equal(
            await in_(inner).globalValue(`${S}b`),
            'aussen',
            'the inner one sees the state of the outer one',
          );
          await write(inner, 'c', 'innen');
          throw new Error('innen kaputt');
        }),
        /innen kaputt/,
      );
      await write(tx, 'd', 'danach');
    });
    assert.deepEqual(
      [await getGlobalSetting(`${S}b`), await getGlobalSetting(`${S}c`), await getGlobalSetting(`${S}d`)],
      ['aussen', null, 'danach'],
    );
  });

  await t.test('whoever asks after COMMIT gets the pool', async () => {
    let subsequent, inside;
    await transaction(async tx => {
      await write(tx, 'e', 'fest');
      inside = db.inTransaction();
      subsequent = new Promise(r => setTimeout(r, 50)).then(async () => [
        db.inTransaction(),
        await db.get('SELECT 1 AS x'),
      ]);
    });
    assert.equal(inside, true);
    assert.deepEqual(await subsequent, [false, { x: 1 }], 'a straggler runs via the pool');
  });
});
