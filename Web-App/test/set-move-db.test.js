/**
 * Set zwischen Konten verschieben — gegen echte Datenbank.
 *
 * ── Warum Verhalten und nicht Quelltext ─────────────────────────────────────
 * Der gemeldete Fehler war eine pg-Warnung:
 *   „Calling client.query() when the client is already executing a query is
 *    deprecated and will be removed in pg@9.0"
 * Ursache: drei Prüfungen liefen per `Promise.all` auf DERSELBEN
 * Transaktionsverbindung.
 *
 * Ein erster Anlauf prüfte das am Quelltext („kein Promise.all mit mehreren
 * tx.-Aufrufen"). Diese Regel hätte den echten Fehler NICHT gefunden: Die
 * Abfragen standen hinter einem Helfer namens has(), nicht als tx.get() im
 * Promise.all. Deshalb hier der Weg, der zählt — der Lauf wird ausgeführt und
 * die Warnungen von Node werden mitgeschrieben.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

test('Set verschieben', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  const { moveSetBetweenAccounts } = _req('utils/setMove.js');

  await db.run("INSERT INTO users (username,password_hash) VALUES ('mv_a','x'),('mv_b','x')");
  const [a, b] = (await db.all('SELECT id FROM users ORDER BY id')).map(r => r.id);

  /** Ein Set mit Inhalt beim Absender anlegen. */
  async function bestandAnlegen(sn, teile, figuren) {
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,$2,'Testset',1)`, [a, sn]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,50,'N')`, [a, sn]);
    for (let i = 0; i < teile; i++) {
      await db.run(`INSERT INTO parts (user_id,set_number,part_number,part_name,color_id,color_name,quantity)
                    VALUES ($1,$2,$3,'Brick',4,'Rot',2)`, [a, sn, `300${i}`]);
    }
    for (let i = 0; i < figuren; i++) {
      await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,fig_name,quantity)
                    VALUES ($1,$2,$3,'Figur',1)`, [a, sn, `fig-00${i}`]);
    }
  }

  await t.test('der Lauf erzeugt keine pg-Warnung über parallele Abfragen', async () => {
    await bestandAnlegen('10001-1', 3, 2);

    const warnungen = [];
    const horcher = (w) => warnungen.push(String(w?.message || w));
    process.on('warning', horcher);
    try {
      await db.transaction(tx => moveSetBetweenAccounts(tx, '10001-1', a, b));
      // Warnungen laufen über den Ereignisfaden — kurz warten, sonst käme die
      // Meldung erst nach dem Test an und niemand sähe sie.
      await new Promise(r => setTimeout(r, 50));
    } finally { process.off('warning', horcher); }

    const parallel = warnungen.filter(w => /already executing a query/i.test(w));
    assert.deepEqual(parallel, [],
      'pg meldet parallele Abfragen auf einer Verbindung — ab pg 9 ist das ein Fehler, nicht nur ein Hinweis');
  });

  await t.test('Teile und Minifiguren wandern mit und werden gezählt', async () => {
    await bestandAnlegen('10002-1', 4, 1);
    const r = await db.transaction(tx => moveSetBetweenAccounts(tx, '10002-1', a, b));

    assert.equal(r.parts, 4, `${r.parts} statt 4 Teile gemeldet`);
    assert.equal(r.minifigs, 1, `${r.minifigs} statt 1 Minifigur gemeldet`);
    assert.equal(r.source_emptied, true, 'das letzte Exemplar ist weg — der Absender muss leer sein');

    const beimZiel = await db.get(
      `SELECT (SELECT COUNT(*)::int FROM parts    WHERE user_id=$1 AND set_number='10002-1') AS teile,
              (SELECT COUNT(*)::int FROM minifigs WHERE user_id=$1 AND set_number='10002-1') AS figuren`, [b]);
    assert.equal(beimZiel.teile, 4);
    assert.equal(beimZiel.figuren, 1);
    const beimAbsender = await db.get(
      `SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10002-1'`, [a]);
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
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,part_name,color_id,color_name,quantity)
                  VALUES ($1,'10004-1','3000','Brick',4,'Rot',2)`, [b]);
    const r = await db.transaction(tx => moveSetBetweenAccounts(tx, '10004-1', a, b));
    assert.equal(r.parts, 0, 'Teile wurden trotz vorhandener Zeilen erneut kopiert');
    const n = await db.get(
      `SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10004-1'`, [b]);
    assert.equal(n.c, 1, 'doppelte Zeilen — die Zusammenfassung zählte die Menge zweimal');
  });

  await db.pool.end().catch(() => {});
});
