/**
 * Inner transactions are savepoints on the connection of the outer one.
 * Two concurrent ones (Promise.all): the ROLLBACK TO of one would silently take the
 * already reported work of the other with it; the second is therefore rejected.
 * Sequential and nested stays allowed. Own access from createDb().
 *
 * Counter-checks (measured 12.11.2026, each on its own):
 *   A  in innerTransaction() the check `stand.innerster !== rahmen`
 *      deleted → red: “two concurrent inner transactions: the second
 *      is rejected” (the second reported success, its row was missing after COMMIT)
 *      and “… also in a savepoint”
 *   B  `stand.innerster = rahmen` deleted in the finally → red: “sequential and
 *      nested stay allowed” (the second of the series was rejected)
 *   C  (13.11.2026) the checks openStill() deleted in database.ts → red: “a
 *      straggler does not spoil …” (25P02 in the foreign transaction); before, the
 *      file was red about every fifth time in the full run and on its own
 *   Since the transaction is passed explicitly (14.11.2026, w5-vertrag), the
 *   test opens the inner one via the access of the handle (`tx.db`), as the context `t` does; which
 *   savepoint is the innermost is told by the handle. Measured again: A, B, C → red as above.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { noDb } = require('./helpers/db');
const { warte } = require('./helpers/time');
// The built module itself, not the facade from buildAndRequire().
const modul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));

const TABLE_NAME = `sp_gleichzeitig_${process.pid}`;

test('savepoints of a transaction', { concurrency: 1 }, async t => {
  const db = modul.createDb(modul.dbConfigFromEnvironment());
  try {
    await db.run(`CREATE TABLE ${TABLE_NAME} (wert TEXT NOT NULL)`);
  } catch (e) {
    await db.pool.end().catch(() => {});
    noDb(t, e);
    return;
  }
  t.after(async () => {
    await db.run(`DROP TABLE IF EXISTS ${TABLE_NAME}`).catch(() => {});
    await db.pool.end();
  });
  const schreibe = (tx, w) => tx.run(`INSERT INTO ${TABLE_NAME} (wert) VALUES ($1)`, [w]);
  const values = async () => (await db.all(`SELECT wert FROM ${TABLE_NAME} ORDER BY wert`)).map(z => z.wert);
  /** An inner transaction via the access of the outer one (like t.transact). */
  const innen = (tx, fn) => tx.db.transaction(fn);
  t.beforeEach(() => db.run(`DELETE FROM ${TABLE_NAME}`));

  await t.test('two concurrent inner transactions: the second is rejected', async () => {
    let results;
    await db.transaction(async tx => {
      await schreibe(tx, 'aussen');
      results = await Promise.allSettled([
        innen(tx, async inner => {
          await schreibe(inner, 'a');
          await warte(50);
          throw new Error('a scheitert');
        }),
        innen(tx, async inner => {
          await schreibe(inner, 'b');
        }),
      ]);
    });
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'rejected', 'die zweite wird abgewiesen, statt Erfolg zu melden');
    assert.ok(results[1].reason instanceof modul.ConcurrentSavepoint, String(results[1].reason));
    assert.match(results[1].reason.message, /sp_\d+ derselben Transaktion noch läuft.*nacheinander ausführen/);
    assert.deepEqual(await values(), ['aussen'], 'was gemeldet wurde, gilt');
  });

  await t.test('… also in a savepoint', async () => {
    await assert.rejects(
      db.transaction(async tx =>
        innen(tx, async inner => {
          await schreibe(inner, 'x');
          await Promise.all([innen(inner, async () => warte(20)), innen(inner, async () => warte(20))]);
        }),
      ),
      modul.ConcurrentSavepoint,
    );
    assert.deepEqual(await values(), []);
  });

  await t.test('a straggler does not spoil the next transaction of its connection', async () => {
    // A pool with one connection: the next transaction surely gets the same.
    const k = modul.dbConfigFromEnvironment();
    const eng = modul.createDb({ ...k, pool: { ...k.pool, max: 1 } });
    try {
      let stragglers;
      await assert.rejects(
        eng.transaction(async tx => {
          stragglers = tx.db.transaction(async inner => {
            await warte(80);
            await schreibe(inner, 'nachzuegler');
          });
          stragglers.catch(() => {});
          throw new Error('aussen scheitert sofort');
        }),
        /aussen scheitert sofort/,
      );
      // The foreign transaction holds the connection until the straggler is done.
      await eng.transaction(async tx => {
        await Promise.allSettled([stragglers]);
        await schreibe(tx, 'fremd');
      });
      await assert.rejects(stragglers, modul.TransactionEnded);
      assert.deepEqual(await values(), ['fremd']);
    } finally {
      await eng.pool.end();
    }
  });

  await t.test('sequential and nested stay allowed', async () => {
    await db.transaction(async tx => {
      await schreibe(tx, '1-aussen');
      await innen(tx, async eins => {
        await schreibe(eins, '2-eins');
        await assert.rejects(
          innen(eins, async tief => {
            await schreibe(tief, '3-tief');
            throw new Error('tief scheitert');
          }),
          /tief scheitert/,
        );
        await innen(eins, async tief => schreibe(tief, '4-tief-danach'));
      });
      await innen(tx, async zwei => schreibe(zwei, '5-zwei'));
    });
    assert.deepEqual(await values(), ['1-aussen', '2-eins', '4-tief-danach', '5-zwei']);
  });

  await t.test('separate outer transactions may run concurrently', async () => {
    await Promise.all(['p', 'q', 'r'].map(w => db.transaction(async tx => schreibe(tx, w))));
    assert.deepEqual(await values(), ['p', 'q', 'r']);
  });
});
