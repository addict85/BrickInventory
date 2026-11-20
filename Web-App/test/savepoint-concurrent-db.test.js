/**
 * Innere Transaktionen sind Sicherungspunkte auf der Verbindung der äusseren.
 * Zwei gleichzeitige (Promise.all): Das ROLLBACK TO des einen nähme die schon
 * gemeldete Arbeit des anderen still mit; der zweite wird deshalb abgewiesen.
 * Nacheinander und verschachtelt bleibt erlaubt. Eigener Zugang aus createDb().
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln):
 *   A  in innerTransaction() die Prüfung `stand.innerster !== rahmen`
 *      gestrichen → rot: „zwei gleichzeitige innere Transaktionen: die zweite
 *      wird abgewiesen“ (die zweite meldete Erfolg, ihre Zeile fehlte nach COMMIT)
 *      und „… auch in einem Sicherungspunkt“
 *   B  `stand.innerster = rahmen` im finally gestrichen → rot: „nacheinander und
 *      verschachtelt bleibt erlaubt“ (die zweite der Reihe wurde abgewiesen)
 *   C  (13.11.2026) die Prüfungen openStill() in database.ts gestrichen → rot: „ein
 *      Nachzügler verdirbt nicht …“ (25P02 in der fremden Transaktion); vorher war
 *      die Datei im Volllauf und einzeln etwa jedes fünfte Mal rot
 *   Seit die Transaktion ausdrücklich gereicht wird (14.11.2026, w5-vertrag), öffnet der
 *   Test die innere über den Zugang des Griffs (`tx.db`), wie es der Kontext `t` tut; welcher
 *   Sicherungspunkt der innerste ist, sagt der Griff. Erneut gemessen: A, B, C → rot wie oben.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * @superuser (Ratsche in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { warte } = require('./helpers/time');
// Das gebaute Modul selbst, nicht die Fassade aus buildAndRequire().
const modul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));

const TABELLE = `sp_gleichzeitig_${process.pid}`;

test('savepoints of a transaction', { concurrency: 1 }, async t => {
  const db = modul.createDb(modul.dbKonfigFromEnvironment());
  try {
    await db.run(`CREATE TABLE ${TABELLE} (wert TEXT NOT NULL)`);
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }
  t.after(async () => {
    await db.run(`DROP TABLE IF EXISTS ${TABELLE}`).catch(() => {});
    await db.pool.end();
  });
  const schreibe = (tx, w) => tx.run(`INSERT INTO ${TABELLE} (wert) VALUES ($1)`, [w]);
  const werte = async () => (await db.all(`SELECT wert FROM ${TABELLE} ORDER BY wert`)).map(z => z.wert);
  /** Eine innere Transaktion über den Zugang der äusseren (wie t.transaktion). */
  const innen = (tx, fn) => tx.db.transaction(fn);
  t.beforeEach(() => db.run(`DELETE FROM ${TABELLE}`));

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
    assert.deepEqual(await werte(), ['aussen'], 'was gemeldet wurde, gilt');
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
    assert.deepEqual(await werte(), []);
  });

  await t.test('a straggler does not spoil the next transaction of its connection', async () => {
    // Ein Pool mit einer Verbindung: Die nächste Transaktion bekommt sicher dieselbe.
    const k = modul.dbKonfigFromEnvironment();
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
      // Die fremde Transaktion hält die Verbindung, bis der Nachzügler fertig ist.
      await eng.transaction(async tx => {
        await Promise.allSettled([stragglers]);
        await schreibe(tx, 'fremd');
      });
      await assert.rejects(stragglers, modul.TransactionEnded);
      assert.deepEqual(await werte(), ['fremd']);
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
    assert.deepEqual(await werte(), ['1-aussen', '2-eins', '4-tief-danach', '5-zwei']);
  });

  await t.test('separate outer transactions may run concurrently', async () => {
    await Promise.all(['p', 'q', 'r'].map(w => db.transaction(async tx => schreibe(tx, w))));
    assert.deepEqual(await werte(), ['p', 'q', 'r']);
  });
});
