/**
 * Teile und Minifiguren: Bestand und Beschreibung sind getrennt.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „in der parts-tabelle benötigt es doch nur id, user_id, set_number,
 *    part_number, color_id, source, storage_od, added_at den Rest ist wieder
 *    in partAcquisitions, rb_parts gespeichert? oder wenn noch Spalten in
 *    rb_parts fehlen dann würde ich eher ein pandant zu set_catalog erstellen
 *    mit part_catalog?"
 *
 *   „bitte das gleiche auch noch für minifigs umsetzen. Auch dort gehören
 *    fig_name, image_url, bl_fig_number, image_local nicht in die
 *    minifigs-Tabelle sondern eher in eine minifigs_catalog tabelle."
 *
 * Die Antwort auf die Rückfrage, GEMESSEN und nicht vermutet: In rb_parts und
 * rb_colors kann nichts von uns liegen. jobs/csvImportWorker.ts füllt beide
 * über importiereMitTausch(), und das macht `DELETE FROM <tabelle>` und
 * schreibt den CSV-Inhalt neu — Nachgetragenes wäre beim nächsten Tageslauf
 * weg. Also das Pendant, genau wie Marco vermutet hat: part_catalog,
 * part_color_catalog, minifigs_catalog (Migration 0034).
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 *
 *   1. Nach der GANZEN Migrationskette tragen parts und minifigs nur noch
 *      Bestandsspalten — und die Beschreibung steht in den Katalogen.
 *   2. Der Riegel in Schritt 2 greift, wenn ein Name verloren ginge. Mit
 *      Gegenprobe: ohne Riegel läuft dieselbe Lage durch und der Name ist weg.
 *   3. Die Teileliste liefert Name, Farbe, Bild und Ersatzteilkennzeichen
 *      weiterhin — über die Katalog-JOINs.
 *   4. Der Lagerortfilter zählt. Das ist kein Beiwerk: Die Zählabfrage stand
 *      auf `FROM parts p` allein, während die Filterbedingung auf lo zeigte.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// Dieselbe Begruendung wie in test/sets-ohne-kaufpreisspalte-db.test.js: Diese
// Datei baut die Datenbank mehrfach von null auf und wendet Migrationen von
// Hand an. Ohne diesen Nachlauf findet die naechste Testdatei einen Zustand,
// den sie nicht erwartet.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[teile-katalogspalten] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

const dbDa = async (t) => {
  try { await db.run('SELECT 1'); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
};

const MIG_DIR = path.join(ROOT, 'db', 'migrations');
const DATEI   = path.join(MIG_DIR, '0034-teile-und-minifiguren-stammdaten-im-katalog.sql');

test('nach der ganzen Kette tragen parts und minifigs nur noch den Bestand',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // ── Zwischenstand: VORHER muessen alle Spalten da sein ────────────────────
  //
  // Keine Zierde, sondern zweierlei auf einmal: der Selbstnachweis fuer die
  // Pruefung darunter (ohne ihn saehe auch eine leere Tabelle gruen aus) und
  // die Zusage, dass die Migrationskette ueberhaupt durchlaeuft.
  //
  // Drei Migrationen fassen diese Spalten an und brechen auf einer fehlenden
  // hart ab:
  //
  //   0007-geld-als-numeric.sql        ALTER COLUMN unit_price/purchase_price TYPE
  //   0014-img-proxy-nach-v1.sql       UPDATE parts SET image_url = ...
  //   0029-trigramm-bestandssuche.sql  CREATE INDEX ... (lower(part_name))
  //
  // Die uebrigen braucht der Nachtrag in Schritt 1c von 0034: Er liest die
  // Beschreibung manuell erfasster Positionen aus dem Bestand und nennt sie
  // alle in EINER Anweisung. GEMESSEN, als category_name in schema.sql fehlte:
  // „Migration 0034 … fehlgeschlagen: column p.category_name does not exist".
  const vorher = await spaltenVon('parts');
  for (const sp of ['part_name', 'color_name', 'color_hex', 'category_name',
                    'image_url', 'image_local', 'is_spare', 'created_at',
                    'unit_price', 'purchase_price']) {
    assert.ok(vorher.includes(sp),
      `parts.${sp} fehlt schon vor den Migrationen — dann bricht Migration ` +
      '0007, 0014, 0029 oder 0034 beim ersten Start einer frischen ' +
      'Installation ab. db/schema.sql muss die Spalte anlegen.');
  }
  const vorherFigs = await spaltenVon('minifigs');
  for (const sp of ['fig_name', 'image_url', 'image_local']) {
    assert.ok(vorherFigs.includes(sp),
      `minifigs.${sp} fehlt vor den Migrationen — siehe die Begruendung bei parts`);
  }

  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // ── Die Zusage: nur noch Bestand ─────────────────────────────────────────
  //
  // Marcos Liste, ergaenzt um die Spalten, die den BESTAND betreffen und die
  // er nicht genannt hat: quantity (Stueckzahl), condition, unit_price und
  // purchase_price (die drei gehen in Etappe 6 in die Erfassungen) und
  // bl_part_number (geht in die Mapping-Tabelle).
  const nachher = await spaltenVon('parts');
  for (const sp of ['part_name', 'color_name', 'color_hex', 'category_name',
                    'image_url', 'image_local', 'is_spare', 'created_at']) {
    assert.ok(!nachher.includes(sp),
      `parts.${sp} ist nach allen Migrationen noch da — Migration 0034 hat nicht ` +
      'geloescht, oder etwas legt die Spalte danach wieder an.');
  }
  for (const sp of ['id', 'user_id', 'set_number', 'part_number', 'color_id',
                    'source', 'storage_id', 'added_at']) {
    assert.ok(nachher.includes(sp),
      `parts.${sp} fehlt — genau diese Spalten soll die Tabelle behalten`);
  }

  const figsNachher = await spaltenVon('minifigs');
  for (const sp of ['fig_name', 'image_url', 'image_local']) {
    assert.ok(!figsNachher.includes(sp),
      `minifigs.${sp} ist nach allen Migrationen noch da`);
  }
  for (const sp of ['id', 'user_id', 'set_number', 'fig_number', 'source', 'storage_id']) {
    assert.ok(figsNachher.includes(sp), `minifigs.${sp} fehlt`);
  }

  // ── Und sie sind nicht verschwunden, sondern umgezogen ───────────────────
  const pc  = await spaltenVon('part_catalog');
  const pcc = await spaltenVon('part_color_catalog');
  const mc  = await spaltenVon('minifigs_catalog');
  for (const sp of ['part_number', 'part_name', 'category_name']) {
    assert.ok(pc.includes(sp), `part_catalog.${sp} fehlt — dann gibt es den Namen nirgends mehr`);
  }
  for (const sp of ['part_number', 'color_id', 'color_name', 'color_hex', 'image_url', 'image_local']) {
    assert.ok(pcc.includes(sp), `part_color_catalog.${sp} fehlt`);
  }
  for (const sp of ['fig_number', 'fig_name', 'image_url', 'image_local']) {
    assert.ok(mc.includes(sp), `minifigs_catalog.${sp} fehlt`);
  }
  // is_spare zieht nicht in einen neuen Katalog: Es ist eine Eigenschaft der
  // TEILELISTE eines Sets und steht dort seit jeher.
  assert.ok((await spaltenVon('set_parts_catalog')).includes('is_spare'),
    'set_parts_catalog.is_spare fehlt — dann gibt es das Ersatzteilkennzeichen nirgends');
});

test('Migration 0034 löscht nur, wenn kein Name verloren geht',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  // ── Warum dieser Test der wichtigere ist ─────────────────────────────────
  //
  // Schritt 1b fuellt die Kataloge aus set_parts_catalog, Schritt 1c aus dem
  // Bestand (fuer manuell erfasste Positionen, die in keinem Set-Katalog
  // stehen), Schritt 2 zaehlt nach und bricht ab, Schritt 3 loescht.
  //
  // Ohne Schritt 2 waere das Loeschen ein Datenverlust mit Ansage: Ein manuell
  // erfasstes Teil haette danach keinen Namen mehr, und er liesse sich aus
  // nichts herleiten.
  //
  // Drei Laeufe auf derselben Lage (ein manuell erfasstes Teil, dessen Name
  // NUR im Bestand steht):
  //
  //   1. ganze Datei            → traegt nach, loescht, der Name ist im Katalog
  //   2. ohne Schritt 1c        → Schritt 2 bricht ab, die Spalten bleiben
  //   3. ohne Schritt 1c und 2  → laeuft durch, die Spalten sind weg, Name weg
  //
  // Lauf 2 ist die Zusage, Lauf 3 die GEGENPROBE: Er zeigt, dass Schritt 2
  // tatsaechlich das ist, was den Verlust verhindert.
  const skript = fs.readFileSync(DATEI, 'utf8');

  // Die Abschnitte woertlich aus der Datei schneiden — nicht nachgebaut.
  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                               skript.indexOf('END $nachtrag$;') + 15);
  const riegel   = skript.slice(skript.indexOf('DO $pruefung$'),
                               skript.indexOf('END $pruefung$;') + 15);
  assert.match(nachtrag, /INSERT INTO part_catalog/,
    'Schritt 1c (der Nachtrag aus dem Bestand) steht nicht mehr als DO $nachtrag$-Block');
  assert.match(riegel, /RAISE EXCEPTION '% Teilenummern wuerden ihren Namen verlieren/,
    'Schritt 2 (der Riegel) steht nicht mehr in der Migration');
  assert.match(riegel, /RAISE EXCEPTION '% Figurennummern wuerden ihren Namen verlieren/,
    'Der Riegel prüft die Figuren nicht mehr');
  assert.ok(skript.indexOf('DO $nachtrag$') < skript.indexOf('DO $pruefung$'),
    'Der Riegel muss NACH dem Nachtrag stehen, sonst prüft er die alte Lage');

  /**
   * Frische Datenbank, alle Migrationen VOR 0034, ein manuell erfasstes Teil
   * und eine manuell erfasste Figur mit Namen nur im Bestand — dann das
   * uebergebene Skript.
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const lauf = async (sql) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(MIG_DIR).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0034')) break;
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('katalog','x')`);
      await c.query(`INSERT INTO parts (user_id,part_number,part_name,color_id,color_name,
                                        color_hex,category_name,quantity,source)
                     SELECT id,'98138','Tile Round 1x1',14,'Yellow','F2CD37','Tiles',7,'manual'
                       FROM users WHERE username='katalog'`);
      await c.query(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source)
                     SELECT id,'fig-999999','Eigenbau-Figur',2,'manual'
                       FROM users WHERE username='katalog'`);
      // Wie die echte Migration: eine Transaktion je Datei (db/migrate.ts).
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('COMMIT'); return null; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return e.message; }
    } finally { c.release(); }
  };

  // ── Lauf 1: die ganze Datei ──────────────────────────────────────────────
  assert.equal(await lauf(skript), null,
    'Die Migration muss auf dieser Lage durchlaufen — Schritt 1c trägt den ' +
    'Namen des manuell erfassten Teils ja gerade nach');
  const imKatalog = await db.get(
    `SELECT part_name, category_name FROM part_catalog WHERE part_number='98138'`);
  assert.ok(imKatalog, 'Schritt 1c hat für das manuell erfasste Teil keine Katalogzeile angelegt');
  assert.equal(imKatalog.part_name, 'Tile Round 1x1',
    'Der Name des manuell erfassten Teils ist beim Umzug verloren gegangen');
  assert.equal(imKatalog.category_name, 'Tiles', 'Die Kategorie ist verloren gegangen');
  const farbe = await db.get(
    `SELECT color_name, color_hex FROM part_color_catalog WHERE part_number='98138' AND color_id=14`);
  assert.equal(farbe?.color_name, 'Yellow', 'Die Farbbezeichnung ist verloren gegangen');
  assert.equal(farbe?.color_hex, 'F2CD37', 'Der Farbcode ist verloren gegangen');
  const figur = await db.get(
    `SELECT fig_name FROM minifigs_catalog WHERE fig_number='fig-999999'`);
  assert.equal(figur?.fig_name, 'Eigenbau-Figur', 'Der Figurenname ist verloren gegangen');

  // ── Lauf 2: ohne Schritt 1c — der Riegel muss greifen ────────────────────
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Schritt 1c wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag);
  assert.match(String(meldung), /1 Teilenummern wuerden ihren Namen verlieren/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  // Und nichts ist gelöscht: Die Datei lief in EINER Transaktion.
  const nachAbbruch = await spaltenVon('parts');
  for (const sp of ['part_name', 'color_name', 'is_spare']) {
    assert.ok(nachAbbruch.includes(sp),
      `parts.${sp} ist trotz Abbruch weg — dann rollt die Transaktion nicht zurück`);
  }
  const nameDa = await db.get(`SELECT part_name FROM parts WHERE part_number='98138'`);
  assert.equal(nameDa?.part_name, 'Tile Round 1x1', 'Der Name ist trotz Abbruch verschwunden');

  // ── Lauf 3: GEGENPROBE, ohne Schritt 1c UND ohne Schritt 2 ───────────────
  const ohneBeides = ohneNachtrag.replace(riegel, '');
  assert.notEqual(ohneBeides, ohneNachtrag, 'Schritt 2 wurde nicht herausgeschnitten');
  assert.equal(await lauf(ohneBeides), null,
    'Ohne den Riegel muss die Datei durchlaufen — sonst beweist Lauf 2 nichts');
  assert.deepEqual(
    (await spaltenVon('parts')).filter(c => ['part_name', 'color_name'].includes(c)), [],
    'Ohne Riegel müssen die Spalten gelöscht sein — sonst beweist Lauf 2 nichts');
  const verloren = await db.get(
    `SELECT part_name FROM part_catalog WHERE part_number='98138'`);
  assert.equal(verloren, undefined,
    'Ohne Schritt 1c darf der Name NICHT im Katalog stehen — er war nur im Bestand. ' +
    'Steht er da, trägt ihn etwas anderes nach und Lauf 2 beweist nichts.');
});

test('die Teileliste liefert Beschreibung und Lagerort aus den Katalogen',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  // Frische, VOLLSTAENDIG migrierte Datenbank — der Zustand einer echten
  // Installation nach dem Hochziehen.
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c0); } finally { c0.release(); }

  const u = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('teilleser','x') RETURNING id`);
  const uid = u.id;

  // Ein Set mit zwei Teilen: eines Pflichtteil, eines Ersatzteil.
  await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ('75192-1','Falcon')`);
  await db.run(`INSERT INTO sets (user_id,set_number,quantity) VALUES ($1,'75192-1',2)`, [uid]);
  await db.run(`INSERT INTO set_parts_catalog
    (set_number,part_number,part_name,color_id,color_name,color_hex,category_name,image_url,is_spare,quantity)
    VALUES ('75192-1','3001','Brick 2x4',4,'Red','C91A09','Bricks','http://cdn/3001r.png',0,6),
           ('75192-1','3002','Brick 2x3',1,'Blue','0055BF','Bricks','http://cdn/3002b.png',1,2)`);
  await db.run(`INSERT INTO part_catalog (part_number,part_name,category_name)
    VALUES ('3001','Brick 2x4','Bricks'),('3002','Brick 2x3','Bricks')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name,color_hex,image_url)
    VALUES ('3001',4,'Red','C91A09','http://cdn/3001r.png'),
           ('3002',1,'Blue','0055BF','http://cdn/3002b.png')`);
  const ort = await db.get(
    `INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3') RETURNING id`, [uid]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,storage_id)
    VALUES ($1,'75192-1','3001',4,6,'set',$2),
           ($1,'75192-1','3002',1,2,'set',NULL)`, [uid, ort.id]);

  const handlers = _req('utils/handlers/parts.js');

  // ── Die Beschreibung kommt an ────────────────────────────────────────────
  const alle = await handlers.getParts(uid, { exclude_manual: '1' });
  const nach = (nr) => alle.parts.find(p => String(p.part_number) === nr);
  assert.equal(alle.parts.length, 2,
    `Erwartet 2 Teile, bekommen ${alle.parts.length}: ${JSON.stringify(alle.parts)}`);
  assert.equal(nach('3001')?.part_name, 'Brick 2x4',
    'Der Teilename kommt nicht aus part_catalog an');
  assert.equal(nach('3001')?.color_name, 'Red',
    'Die Farbbezeichnung kommt nicht aus part_color_catalog an');
  assert.equal(nach('3001')?.color_hex, 'C91A09', 'Der Farbcode kommt nicht an');
  assert.equal(nach('3001')?.category_name, 'Bricks', 'Die Kategorie kommt nicht an');
  assert.equal(nach('3001')?.image_url, 'http://cdn/3001r.png', 'Das Bild kommt nicht an');
  // Menge: 6 Teile je Set, 2 Sets im Bestand.
  assert.equal(nach('3001')?.total_quantity, 12,
    'Die Menge wird nicht mehr mit der Set-Anzahl multipliziert');

  // ── is_spare aus set_parts_catalog, als echter Wahrheitswert ─────────────
  assert.equal(nach('3001')?.is_spare, false,
    'Ein Pflichtteil wird als Ersatzteil gemeldet');
  assert.equal(nach('3002')?.is_spare, true,
    'Das Ersatzteilkennzeichen kommt nicht aus set_parts_catalog an');
  const nurErsatz = await handlers.getParts(uid, { exclude_manual: '1', spare: '1' });
  assert.deepEqual(nurErsatz.parts.map(p => String(p.part_number)), ['3002'],
    `spare=1 filtert nicht über set_parts_catalog: ${JSON.stringify(nurErsatz.parts.map(p => p.part_number))}`);

  // ── Der Farbfilter ───────────────────────────────────────────────────────
  const nurRot = await handlers.getParts(uid, { exclude_manual: '1', color: 'Red' });
  assert.deepEqual(nurRot.parts.map(p => String(p.part_number)), ['3001'],
    'Der Farbfilter greift nicht über part_color_catalog');

  // ── Der Lagerortfilter — und seine ZAEHLUNG ──────────────────────────────
  //
  // Das ist der Teil, der vor dieser Aenderung nicht ging: Die Zaehlabfrage in
  // getParts() stand auf `FROM parts p` allein, waehrend die Filterbedingung
  // auf lo.name zeigt. GEMESSEN war die Folge „missing FROM-clause entry for
  // table lo" und damit eine 500er-Antwort fuer die ganze Teileliste.
  //
  // `total` ist deshalb die eigentliche Zusicherung: Sie kommt NUR aus der
  // Zaehlabfrage. Stimmt die Liste und total ist 0 oder die Abfrage wirft,
  // ist genau dieser Fehler zurueck.
  const inKiste = await handlers.getParts(uid, { exclude_manual: '1', storage: 'Kiste 3' });
  assert.deepEqual(inKiste.parts.map(p => String(p.part_number)), ['3001'],
    'Der Lagerortfilter liefert die falschen Teile');
  assert.equal(inKiste.total, 1,
    `Die Zählabfrage des Lagerortfilters gibt ${inKiste.total} statt 1 — ` +
    'sie braucht dieselben JOINs wie die Hauptabfrage (joinClause)');
  assert.equal(inKiste.parts[0].storage, 'Kiste 3',
    'Der Lagerortname kommt nicht aus storage_locations an');

  // ── Suche über den Katalognamen ──────────────────────────────────────────
  const gesucht = await handlers.getParts(uid, { exclude_manual: '1', search: 'brick 2x3' });
  assert.deepEqual(gesucht.parts.map(p => String(p.part_number)), ['3002'],
    'Die Suche findet den Teilenamen nicht mehr (er steht in part_catalog)');
});

test('die Figurenliste liefert Name und Bild aus minifigs_catalog',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c0 = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c0); } finally { c0.release(); }

  const u = await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('figleser','x') RETURNING id`);
  const uid = u.id;
  await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ('75192-1','Falcon')`);
  await db.run(`INSERT INTO sets (user_id,set_number,quantity) VALUES ($1,'75192-1',3)`, [uid]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_url)
    VALUES ('fig-000123','Chewbacca','http://cdn/chewie.png')`);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
    VALUES ($1,'75192-1','fig-000123',1,'set')`, [uid]);

  const handlers = _req('utils/handlers/minifigs.js');
  const liste = await handlers.getMinifigs(uid, {});
  const figs = liste.minifigs || liste.figs || liste;
  const f = (Array.isArray(figs) ? figs : []).find(x => x.fig_number === 'fig-000123');
  assert.ok(f, `Die Figur fehlt in der Antwort: ${JSON.stringify(liste).slice(0, 400)}`);
  assert.equal(f.fig_name, 'Chewbacca', 'Der Figurenname kommt nicht aus minifigs_catalog an');
  assert.equal(f.image_url, 'http://cdn/chewie.png', 'Das Figurenbild kommt nicht an');
  assert.equal(Number(f.total_quantity), 3,
    'Die Menge wird nicht mehr mit der Set-Anzahl multipliziert');

  // Die Suche läuft über den Katalognamen.
  const gesucht = await handlers.getMinifigs(uid, { search: 'chewb' });
  const gFigs = gesucht.minifigs || gesucht.figs || gesucht;
  assert.equal((Array.isArray(gFigs) ? gFigs : []).length, 1,
    'Die Suche findet den Figurennamen nicht mehr (er steht in minifigs_catalog)');
});
