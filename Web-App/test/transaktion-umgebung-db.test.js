/**
 * Eine Transaktion gilt für den Aufrufpfad, der für sie freigegeben ist (tx.gebunden,
 * wie es der Kontext `t` tut): Dann lesen und schreiben auch Repositories ohne
 * tx-Parameter über ihre Verbindung; ohne Freigabe wirft die Abfrage
 * (UngebundeneAbfrage). Eine innere Transaktion ist ein Sicherungspunkt, und wer
 * nach COMMIT noch fragt, bekommt den Pool.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in all() die Abfrage von txClient() gestrichen → rot: „ein Dienst ohne
 *      tx-Parameter sieht, was die Transaktion geschrieben hat“
 *   B  transaction() ohne Sicherungspunkt (innere läuft auf eigener
 *      Verbindung) → rot: „eine gescheiterte innere Transaktion …“, die
 *      innere sieht den Stand der äusseren nicht
 *   B2 ROLLBACK TO SAVEPOINT gestrichen → rot: dieselbe Prüfung, die
 *      Zeile der inneren bleibt stehen
 *   C  `stand.offen = false` nach COMMIT gestrichen → rot: „wer nach COMMIT
 *      fragt, bekommt den Pool“
 *   D  (14.11.2026) in txStand() die Freigabe nicht geprüft → rot: „ein Dienst ohne
 *      tx-Parameter … ohne Freigabe wirft er“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');

test('Transaktion im Aufrufpfad', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const S = `tx_umgebung_${process.pid}`;
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key LIKE $1', [`${S}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { getGlobalSetting } = _req('src/einstellungen/settings.js');
  const schreibe = (tx, k, v) => tx.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [`${S}${k}`, v]);

  await t.test(
    'ein Dienst ohne tx-Parameter sieht, was die Transaktion geschrieben hat; ohne Freigabe wirft er',
    async () => {
      let gesehen;
      await assert.rejects(
        db.transaction(async tx => {
          await schreibe(tx, 'a', 'eins');
          await assert.rejects(getGlobalSetting(`${S}a`), { name: 'Error', message: /ungebundenen Zugang/ });
          gesehen = await tx.gebunden(() => getGlobalSetting(`${S}a`));
          throw new Error('zurück');
        }),
        /zurück/,
      );
      assert.equal(gesehen, 'eins');
      assert.equal(await getGlobalSetting(`${S}a`), null, 'mit der Transaktion zurückgerollt');
    },
  );

  await t.test('eine gescheiterte innere Transaktion lässt die äussere weiterlaufen', async () => {
    await db.transaction(async tx => {
      await schreibe(tx, 'b', 'aussen');
      await assert.rejects(
        tx.gebunden(() =>
          db.transaction(async inner => {
            assert.equal(
              await inner.gebunden(() => getGlobalSetting(`${S}b`)),
              'aussen',
              'die innere sieht den Stand der äusseren',
            );
            await schreibe(inner, 'c', 'innen');
            throw new Error('innen kaputt');
          }),
        ),
        /innen kaputt/,
      );
      await schreibe(tx, 'd', 'danach');
    });
    assert.deepEqual(
      [await getGlobalSetting(`${S}b`), await getGlobalSetting(`${S}c`), await getGlobalSetting(`${S}d`)],
      ['aussen', null, 'danach'],
    );
  });

  await t.test('wer nach COMMIT fragt, bekommt den Pool', async () => {
    let spaeter, drinnen;
    await db.transaction(async tx => {
      await schreibe(tx, 'e', 'fest');
      drinnen = db.inTransaktion();
      spaeter = new Promise(r => setTimeout(r, 50)).then(async () => [
        db.inTransaktion(),
        await db.get('SELECT 1 AS x'),
      ]);
    });
    assert.equal(drinnen, true);
    assert.deepEqual(await spaeter, [false, { x: 1 }], 'ein Nachzügler läuft über den Pool');
  });
});
