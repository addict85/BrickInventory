/**
 * Innere Transaktionen sind Sicherungspunkte auf der Verbindung der äusseren.
 * Zwei gleichzeitige (Promise.all): Das ROLLBACK TO des einen nähme die schon
 * gemeldete Arbeit des anderen still mit; der zweite wird deshalb abgewiesen.
 * Nacheinander und verschachtelt bleibt erlaubt. Eigener Zugang aus erzeugeDb().
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln):
 *   A  in innereTransaktion() die Prüfung `stand.innerster !== rahmen`
 *      gestrichen → rot: „zwei gleichzeitige innere Transaktionen: die zweite
 *      wird abgewiesen“ (die zweite meldete Erfolg, ihre Zeile fehlte nach COMMIT)
 *      und „… auch in einem Sicherungspunkt“
 *   B  `stand.innerster = rahmen` im finally gestrichen → rot: „nacheinander und
 *      verschachtelt bleibt erlaubt“ (die zweite der Reihe wurde abgewiesen)
 *   C  (13.11.2026) die Prüfungen nochOffen() in database.ts gestrichen → rot: „ein
 *      Nachzügler verdirbt nicht …“ (25P02 in der fremden Transaktion); vorher war
 *      die Datei im Volllauf und einzeln etwa jedes fünfte Mal rot
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { warte } = require('./helpers/zeit');
// Das gebaute Modul selbst, nicht die Fassade aus buildAndRequire().
const modul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));

const TABELLE = `sp_gleichzeitig_${process.pid}`;

test('Sicherungspunkte einer Transaktion', { concurrency: 1 }, async t => {
  const db = modul.erzeugeDb(modul.dbKonfigAusUmgebung());
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
  t.beforeEach(() => db.run(`DELETE FROM ${TABELLE}`));

  await t.test('zwei gleichzeitige innere Transaktionen: die zweite wird abgewiesen', async () => {
    let ergebnisse;
    await db.transaction(async tx => {
      await schreibe(tx, 'aussen');
      ergebnisse = await Promise.allSettled([
        db.transaction(async inner => {
          await schreibe(inner, 'a');
          await warte(50);
          throw new Error('a scheitert');
        }),
        db.transaction(async inner => {
          await schreibe(inner, 'b');
        }),
      ]);
    });
    assert.equal(ergebnisse[0].status, 'rejected');
    assert.equal(ergebnisse[1].status, 'rejected', 'die zweite wird abgewiesen, statt Erfolg zu melden');
    assert.ok(ergebnisse[1].reason instanceof modul.GleichzeitigerSicherungspunkt, String(ergebnisse[1].reason));
    assert.match(ergebnisse[1].reason.message, /sp_\d+ derselben Transaktion noch läuft.*nacheinander ausführen/);
    assert.deepEqual(await werte(), ['aussen'], 'was gemeldet wurde, gilt');
  });

  await t.test('… auch in einem Sicherungspunkt', async () => {
    await assert.rejects(
      db.transaction(async () =>
        db.transaction(async inner => {
          await schreibe(inner, 'x');
          await Promise.all([db.transaction(async () => warte(20)), db.transaction(async () => warte(20))]);
        }),
      ),
      modul.GleichzeitigerSicherungspunkt,
    );
    assert.deepEqual(await werte(), []);
  });

  await t.test('ein Nachzügler verdirbt nicht die nächste Transaktion seiner Verbindung', async () => {
    // Ein Pool mit einer Verbindung: Die nächste Transaktion bekommt sicher dieselbe.
    const k = modul.dbKonfigAusUmgebung();
    const eng = modul.erzeugeDb({ ...k, pool: { ...k.pool, max: 1 } });
    try {
      let nachzuegler;
      await assert.rejects(
        eng.transaction(async () => {
          nachzuegler = eng.transaction(async inner => {
            await warte(80);
            await schreibe(inner, 'nachzuegler');
          });
          nachzuegler.catch(() => {});
          throw new Error('aussen scheitert sofort');
        }),
        /aussen scheitert sofort/,
      );
      // Die fremde Transaktion hält die Verbindung, bis der Nachzügler fertig ist.
      await eng.transaction(async tx => {
        await Promise.allSettled([nachzuegler]);
        await schreibe(tx, 'fremd');
      });
      await assert.rejects(nachzuegler, modul.TransaktionBeendet);
      assert.deepEqual(await werte(), ['fremd']);
    } finally {
      await eng.pool.end();
    }
  });

  await t.test('nacheinander und verschachtelt bleibt erlaubt', async () => {
    await db.transaction(async tx => {
      await schreibe(tx, '1-aussen');
      await db.transaction(async eins => {
        await schreibe(eins, '2-eins');
        await assert.rejects(
          db.transaction(async tief => {
            await schreibe(tief, '3-tief');
            throw new Error('tief scheitert');
          }),
          /tief scheitert/,
        );
        await db.transaction(async tief => schreibe(tief, '4-tief-danach'));
      });
      await db.transaction(async zwei => schreibe(zwei, '5-zwei'));
    });
    assert.deepEqual(await werte(), ['1-aussen', '2-eins', '4-tief-danach', '5-zwei']);
  });

  await t.test('getrennte äussere Transaktionen dürfen gleichzeitig laufen', async () => {
    await Promise.all(['p', 'q', 'r'].map(w => db.transaction(async tx => schreibe(tx, w))));
    assert.deepEqual(await werte(), ['p', 'q', 'r']);
  });
});
