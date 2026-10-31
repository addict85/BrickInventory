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

const _req = require('./helpers/sources').buildAndRequire();
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');
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
  // ── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────
  //
  // Diese Datei loescht das Schema und baut es neu auf. Ohne die Migrationen
  // bleibt die Datenbank auf dem Stand von db/schema.sql stehen — also VOR
  // allen Migrationen —, und das ist nicht nur fuer sie selbst falsch,
  // sondern fuer jede Datei danach: Sie erbt eine halbe Datenbank.
  //
  // GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
  // `parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
  // Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
  // Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
  {
    const mc = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  }

  const { moveSetBetweenAccounts } = _req('src/sets/setMove.js');

  await db.run("INSERT INTO users (username,password_hash) VALUES ('mv_a','x'),('mv_b','x')");
  const [a, b] = (await db.all('SELECT id FROM users ORDER BY id')).map(r => r.id);

  /** Ein Set mit Inhalt beim Absender anlegen. */
  async function bestandAnlegen(sn, teile, figuren) {
    await haeltSet(db, a, sn, 0);  // Menge 0: die Erfassung dahinter traegt sie
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,50,'N')`, [a, sn]);
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
    await haeltTeil(db, b, '3000', { setNumber: '10004-1', menge: 2, colorId: 4 });
    const r = await db.transaction(tx => moveSetBetweenAccounts(tx, '10004-1', a, b));
    assert.equal(r.parts, 0, 'Teile wurden trotz vorhandener Zeilen erneut kopiert');
    const n = await db.get(
      `SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10004-1'`, [b]);
    assert.equal(n.c, 1, 'doppelte Zeilen — die Zusammenfassung zählte die Menge zweimal');
  });

  await db.pool.end().catch(() => {});
});
