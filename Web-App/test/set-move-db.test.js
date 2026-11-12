/**
 * Set zwischen Konten verschieben — gegen echte Datenbank.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');
const db = _req('db/database.js');

test('Set verschieben', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die MIGRATIONEN, nicht nur das Schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  const { moveSetBetweenAccounts } = _req('src/sets/index.js');

  await db.run("INSERT INTO users (username,password_hash) VALUES ('mv_a','x'),('mv_b','x')");
  const [a, b] = (await db.all('SELECT id FROM users ORDER BY id')).map(r => r.id);

  /** Ein Set mit Inhalt beim Absender anlegen. */
  async function bestandAnlegen(sn, teile, figuren) {
    await haeltSet(db, a, sn, 0); // Menge 0: die Erfassung dahinter traegt sie
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,50,'N')`,
      [a, sn],
    );
    for (let i = 0; i < teile; i++) {
      await haeltTeil(db, a, `300${i}`, { setNumber: sn, menge: 2, colorId: 4 });
    }
    for (let i = 0; i < figuren; i++) {
      await haeltFigur(db, a, `fig-00${i}`, { setNumber: sn, menge: 1 });
    }
  }

  await t.test('der Lauf erzeugt keine pg-Warnung über parallele Abfragen', async () => {
    await bestandAnlegen('10001-1', 3, 2);

    const warnungen = [];
    const horcher = w => warnungen.push(String(w?.message || w));
    process.on('warning', horcher);
    try {
      await db.transaction(tx => moveSetBetweenAccounts(tx, '10001-1', a, b));
      // Warnungen laufen über den Ereignisfaden — kurz warten, sonst käme die
      // Meldung erst nach dem Test an und niemand sähe sie.
      await new Promise(r => setTimeout(r, 50));
    } finally {
      process.off('warning', horcher);
    }

    const parallel = warnungen.filter(w => /already executing a query/i.test(w));
    assert.deepEqual(
      parallel,
      [],
      'pg meldet parallele Abfragen auf einer Verbindung — ab pg 9 ist das ein Fehler, nicht nur ein Hinweis',
    );
  });

  await t.test('Teile und Minifiguren wandern mit und werden gezählt', async () => {
    await bestandAnlegen('10002-1', 4, 1);
    const r = await db.transaction(tx => moveSetBetweenAccounts(tx, '10002-1', a, b));

    assert.equal(r.parts, 4, `${r.parts} statt 4 Teile gemeldet`);
    assert.equal(r.minifigs, 1, `${r.minifigs} statt 1 Minifigur gemeldet`);
    assert.equal(r.source_emptied, true, 'das letzte Exemplar ist weg — der Absender muss leer sein');

    const beimZiel = await db.get(
      `SELECT (SELECT COUNT(*)::int FROM parts    WHERE user_id=$1 AND set_number='10002-1') AS teile,
              (SELECT COUNT(*)::int FROM minifigs WHERE user_id=$1 AND set_number='10002-1') AS figuren`,
      [b],
    );
    assert.equal(beimZiel.teile, 4);
    assert.equal(beimZiel.figuren, 1);
    const beimAbsender = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10002-1'`, [
      a,
    ]);
    assert.equal(beimAbsender.c, 0, 'beim Absender blieben Teile ohne Set zurück');
  });

  await t.test('ohne Inhalt sind 0 Teile die richtige Antwort, nicht ein Fehler', async () => {
    // Genau der Fall aus dem Bildschirmfoto: Ein Set, zu dem nie Teile
    // importiert wurden, meldet 0 — die Zahl ist wahr, nur die Meldung in der
    // App wirkt wie ein Fehler.
    await bestandAnlegen('10003-1', 0, 0);
    const r = await db.transaction(tx => moveSetBetweenAccounts(tx, '10003-1', a, b));
    assert.equal(r.parts, 0);
    assert.equal(r.minifigs, 0);
    assert.equal(r.quantity, 1, 'das Exemplar selbst muss trotzdem gewandert sein');
  });

  await t.test('hat das Ziel schon Teile, wird nicht doppelt kopiert', async () => {
    await bestandAnlegen('10004-1', 2, 0);
    await haeltTeil(db, b, '3000', { setNumber: '10004-1', menge: 2, colorId: 4 });
    const r = await db.transaction(tx => moveSetBetweenAccounts(tx, '10004-1', a, b));
    assert.equal(r.parts, 0, 'Teile wurden trotz vorhandener Zeilen erneut kopiert');
    const n = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10004-1'`, [b]);
    assert.equal(n.c, 1, 'doppelte Zeilen — die Zusammenfassung zählte die Menge zweimal');
  });

  await t.test(
    'Teilverschiebung lässt dem Absender alles; manuelle Teile bleiben auch beim letzten Exemplar',
    async () => {
      // Gegenprobe (31.10.2026): `if (remaining > 0)` in setMove.ts auf `if (false)`
      // → rot (Absender ohne Set); `<> 'manual'` in entferneSet gestrichen → rot
      // (manuelles Teil weg).
      await bestandAnlegen('10005-1', 2, 1);
      await db.run(
        `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,'10005-1',1,60,'U',NOW() - interval '2 days')`,
        [a],
      );
      await haeltTeil(db, a, '3005', { menge: 2, colorId: 4 });
      const [erste, zweite] = (
        await db.all("SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='10005-1' ORDER BY id", [a])
      ).map(r => r.id);
      const z = uid =>
        db.get(
          `SELECT (SELECT COUNT(*)::int FROM sets WHERE user_id=$1 AND set_number='10005-1') AS sets,
              (SELECT COUNT(*)::int FROM parts WHERE user_id=$1 AND set_number='10005-1') AS teile,
              (SELECT COUNT(*)::int FROM minifigs WHERE user_id=$1 AND set_number='10005-1') AS figuren,
              (SELECT COUNT(*)::int FROM parts WHERE user_id=$1 AND source='manual') AS manuell`,
          [uid],
        );

      const r1 = await db.transaction(tx => moveSetBetweenAccounts(tx, '10005-1', a, b, [erste]));
      assert.equal(r1.source_emptied, false);
      assert.deepEqual(await z(a), { sets: 1, teile: 2, figuren: 1, manuell: 1 });
      assert.deepEqual(await z(b), { sets: 1, teile: 2, figuren: 1, manuell: 0 });

      const r2 = await db.transaction(tx => moveSetBetweenAccounts(tx, '10005-1', a, b, [zweite]));
      assert.equal(r2.source_emptied, true);
      assert.deepEqual(await z(a), { sets: 0, teile: 0, figuren: 0, manuell: 1 });
    },
  );

  await db.pool.end().catch(() => {});
});
