/**
 * Die Stückzahl eines Teils oder einer Figur steht nicht mehr an der Zeile.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 *   „Bei den Minifigs und parts gibt es noch immer ein quantity"
 *
 * Richtig, und er hätte es nicht selbst finden müssen. Migration 0036 hat
 * `sets.quantity` gelöscht; bei Teilen und Figuren blieb die Spalte stehen,
 * weil sie ZWEI Bedeutungen trug:
 *
 *   source='manual'  wie viele ich besitze    → Summe der Erfassungen
 *   source='set'     wie viele im SET stecken → set_parts_catalog.quantity
 *                                               bzw. set_minifigs_catalog
 *
 * Beide waren Abschriften. GEMESSEN: utils/partsImport.ts schrieb denselben
 * Wert in DERSELBEN Schleife nach `parts.quantity` UND nach
 * `set_parts_catalog.quantity`; utils/minifigsImport.ts wortgleich. Für die
 * manuellen Positionen war mengeNeuRechnen() in utils/bestandsmenge.ts der
 * einzige Schreiber — und der rechnete nichts anderes als die Summe der
 * Erfassungen.
 *
 * Migration 0038 löscht beide Spalten. Die Fallunterscheidung steht einmal,
 * in utils/bestandsmenge.ts (teilmengeJoin/teilmengeAus), und wird von den
 * Lesestellen eingesetzt — dieselbe Bauart wie mengeJoin/mengeAus für die
 * Sets.
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 *
 *   1. Nach der GANZEN Kette gibt es die beiden Spalten nicht mehr — und
 *      VORHER gibt es sie, weil Schritt 1 und der Riegel von 0038 sie LESEN.
 *      Dazu: die vier Indizes, die 0038 setzt.
 *   2. Die Migration lässt nichts verschwinden. Sieben Läufe, jeder mit
 *      Gegenprobe: fehlende Katalogzeile (nachgetragen), Drift (angehalten),
 *      Doppelte (zusammengelegt) — und jeweils der Lauf OHNE den Schritt, der
 *      es verhindert, damit bewiesen ist, dass er es verhindert.
 *   3. Niemand SCHREIBT die beiden Spalten mehr.
 *   4. Die Lesewege liefern die Stückzahl weiter — aus dem Katalog für ein
 *      Set-Teil, aus den Erfassungen für eine manuelle Position. Mit
 *      Gegenproben: Ändert sich die Quelle, folgt die Antwort.
 *   5. Jede Lesestelle wird AUSGEFÜHRT. Das ist kein Beiwerk: teilmengeAus()
 *      liest den Alias `tm_e`, den erst teilmengeJoin() anhängt. Fehlt der
 *      JOIN, ist das kein stiller Fehler, sondern „missing FROM-clause entry
 *      for table tm_e" — GEMESSEN in getMinifigStats(), wo genau das passiert
 *      war. Ein Muster über den Quelltext hat diesen Fall NICHT gefunden
 *      (zwei seiner drei Treffer waren Fehlmeldungen: ein Bruchstück wird in
 *      eine Abfrage eingesetzt, die den JOIN trägt). Ausführen findet ihn.
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

// Dieselbe Begruendung wie in test/setmenge-aus-erfassungen-db.test.js: Diese
// Datei baut die Datenbank mehrfach von null auf. Wer danach laeuft, muss sie
// VOLLSTAENDIG vorfinden — Schema UND Migrationen. Ohne das erbt die naechste
// Datei eine halbe Datenbank, und ihr Fehlschlag sieht aus wie ihr eigener.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[teilemengen-abgeleitet] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

const indizes = async () => (await db.all(
  `SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).map(r => r.indexname);

const dbDa = async (t) => {
  try { await db.run('SELECT 1'); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
};

const MIG_DIR = path.join(ROOT, 'db', 'migrations');
const DATEI   = path.join(MIG_DIR, '0038-teilemengen-aus-katalog-und-erfassungen.sql');

/** Frische Datenbank, Schema, alle Migrationen. */
async function volleKette() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
}

test('nach der ganzen Kette tragen parts und minifigs keine quantity mehr',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // ── Der Selbstnachweis ───────────────────────────────────────────────────
  //
  // VOR den Migrationen muessen die Spalten da sein, und das ist keine
  // Formalie: Schritt 1 von 0038 LIEST `parts.quantity` (er traegt daraus die
  // fehlenden Katalogzeilen nach), der Riegel LIEST sie ebenfalls. Fehlten sie
  // in db/schema.sql, verloere jede bestehende Installation beim naechsten
  // Start ihre Stueckzahlen — ohne dass etwas abbraeche.
  //
  // Ohne diese Zusicherung saehe die Pruefung darunter auch dann gruen aus,
  // wenn die Spalten nie existiert haetten, und bewiese nichts.
  for (const tab of ['parts', 'minifigs']) {
    assert.ok((await spaltenVon(tab)).includes('quantity'),
      `${tab}.quantity fehlt schon vor den Migrationen — dann hat Schritt 1 von ` +
      `Migration 0038 nichts zu lesen, und die Stueckzahl jeder bestehenden ` +
      `Zeile ist beim ersten Start verloren.`);
  }

  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  for (const tab of ['parts', 'minifigs']) {
    assert.ok(!(await spaltenVon(tab)).includes('quantity'),
      `${tab}.quantity ist nach allen Migrationen noch da — Migration 0038 hat ` +
      `nicht geloescht, oder etwas legt die Spalte danach wieder an.`);
  }

  // Was eine Bestandszeile noch ist: DIESES Konto hat DIESES Teil, aus DEM
  // Set, an DEM Ort, in DEM Zustand.
  const teile = await spaltenVon('parts');
  for (const sp of ['id', 'user_id', 'part_number', 'color_id', 'set_number',
                    'source', 'storage_id']) {
    assert.ok(teile.includes(sp), `parts.${sp} fehlt — die Spalte gehoert zum Bestand`);
  }

  // Nicht verschwunden, sondern umgezogen — und zwar an ZWEI Stellen, je
  // nachdem, was die Zahl bedeutet.
  for (const [tab, sp] of [['set_parts_catalog', 'quantity'],
                           ['set_minifigs_catalog', 'quantity'],
                           ['part_acquisitions', 'quantity'],
                           ['minifig_acquisitions', 'quantity']]) {
    assert.ok((await spaltenVon(tab)).includes(sp),
      `${tab}.${sp} fehlt — dann gibt es die Stueckzahl nirgends mehr`);
  }

  // Die vier Indizes aus Schritt 5 und 6. Die beiden eindeutigen sind nicht
  // Kosmetik: Ohne sie war das `ON CONFLICT DO NOTHING` der Importe
  // WIRKUNGSLOS (es gab keinen Konflikt, auf den es treffen konnte), und
  // jeder erneute Import desselben Sets legte neue Zeilen an. Ab 0038 liest
  // jede Zeile dieselbe Katalogzahl — zwei Zeilen zaehlten doppelt.
  const ix = await indizes();
  for (const name of ['idx_parts_eindeutig', 'idx_minifigs_eindeutig',
                      'idx_part_acq_gruppe', 'idx_minifig_acq_gruppe']) {
    assert.ok(ix.includes(name), `${name} fehlt (Migration 0038, Schritt 5/6)`);
  }

  // Und sie sind wirklich EINDEUTIG — ein Index mit demselben Namen, aber
  // ohne UNIQUE, waere hier sonst nicht zu unterscheiden.
  for (const name of ['idx_parts_eindeutig', 'idx_minifigs_eindeutig']) {
    const r = await db.get(
      `SELECT indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = $1`, [name]);
    assert.equal(r?.indisunique, true, `${name} ist nicht eindeutig`);
  }
});

test('Migration 0038 löscht nur, wenn keine Stückzahl verloren geht',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  const skript = fs.readFileSync(DATEI, 'utf8');

  // ── Die Schritte und ihre Reihenfolge ────────────────────────────────────
  //
  // Die Reihenfolge ist die ganze Sicherheit dieser Migration: Nachtrag vor
  // Riegel (sonst prueft der Riegel die alte Lage), Riegel vor dem
  // Zusammenlegen (sonst legt es bei echter Uneinigkeit zusammen),
  // Zusammenlegen vor dem Loeschen (danach fehlt die Zahl zum Entscheiden),
  // Loeschen vor dem eindeutigen Index (sonst bliebe die Doppelung).
  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                               skript.indexOf('END $nachtrag$;') + 15);
  const riegel   = skript.slice(skript.indexOf('DO $pruefung$'),
                               skript.indexOf('END $pruefung$;') + 15);
  const zusammen = skript.slice(skript.indexOf('DELETE FROM parts a'),
                               skript.indexOf('-- ── Schritt 4:'));
  assert.ok(nachtrag.length > 100 && riegel.length > 100 && zusammen.length > 100,
    'Einer der drei Abschnitte wurde nicht gefunden — die Anker im Skript haben ' +
    'sich geaendert, und die Gegenproben unten schneiden dann nichts heraus');
  assert.match(nachtrag, /INSERT INTO set_parts_catalog/,
    'Schritt 1 traegt keine Teile-Katalogzeilen mehr nach');
  assert.match(nachtrag, /INSERT INTO set_minifigs_catalog/,
    'Schritt 1 traegt keine Figuren-Katalogzeilen mehr nach');
  assert.match(riegel, /RAISE EXCEPTION '% Set-Teile haben keine Katalogzeile/,
    'Der Riegel prueft nicht mehr auf fehlende Katalogzeilen');
  assert.match(riegel, /kommt die Katalogzahl im Bestand nicht vor/,
    'Der Riegel prueft nicht mehr, ob die Katalogzahl im Bestand ueberhaupt vorkommt');
  assert.match(riegel, /liegen an VERSCHIEDENEN Lagerorten/,
    'Der Riegel prueft nicht mehr, ob die Doppelten in verschiedenen Kisten liegen');
  assert.match(riegel, /weicht quantity von der Summe der Erfassungen ab/,
    'Der Riegel prueft die manuellen Positionen nicht mehr gegen ihre Erfassungen');
  assert.match(zusammen, /DELETE FROM minifigs a/,
    'Schritt 3 legt die doppelten Figuren-Zeilen nicht mehr zusammen');

  const stelle = (text) => skript.indexOf(text);
  assert.ok(stelle('DO $nachtrag$') < stelle('DO $pruefung$'),
    'Der Riegel muss NACH dem Nachtrag stehen, sonst prueft er die alte Lage');
  assert.ok(stelle('DO $pruefung$') < stelle('DELETE FROM parts a'),
    'Das Zusammenlegen muss NACH dem Riegel stehen — sonst legt es bei echter ' +
    'Uneinigkeit zusammen, statt einen Menschen zu fragen');
  assert.ok(stelle('DELETE FROM parts a') < stelle('ALTER TABLE parts    DROP COLUMN'),
    'Das Zusammenlegen muss VOR dem Loeschen stehen — danach gibt es die Zahl ' +
    'nicht mehr, mit der sich entscheiden liesse');
  assert.ok(stelle('ALTER TABLE parts    DROP COLUMN') < stelle('idx_parts_eindeutig'),
    'Der eindeutige Index steht vor dem Loeschen der Spalte');

  /**
   * Frische Datenbank, alle Migrationen VOR 0038, eine gewählte Lage, dann
   * das übergebene Skript in einer Transaktion.
   *
   * @param sql   das auszuführende Skript
   * @param lage  Schlüssel aus LAGEN
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const LAGEN = {
    // Set-Teil mit Stückzahl 4, aber OHNE Katalogzeile. Schritt 1 muss sie
    // nachtragen; ohne ihn fiele die Zahl auf den Rückfallwert 1.
    ohneKatalog: `
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,4,'set' FROM users WHERE username='tm'`,
    // Abschrift 10, Katalog 6 — echte Uneinigkeit. Hier soll ein MENSCH
    // entscheiden, nicht die Migration.
    drift: `
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,6);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,10,'set' FROM users WHERE username='tm'`,
    // Dasselbe, aber einig: Die Migration muss durchlaufen.
    stimmig: `
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,6);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,6,'set' FROM users WHERE username='tm'`,
    // ── ZWEI Zeilen fuer denselben Schluessel ────────────────────────────
    //
    // Hier stand 6 + 4 bei Katalog 10 — die Annahme, zwei Zeilen seien zwei
    // Anteile, die sich addieren. Marcos Installation hat das widerlegt:
    // `parts.quantity` war fuer ein Set-Teil die Zahl JE EXEMPLAR des Sets,
    // und zwei Zeilen sind KOPIEN derselben Aussage (ein zweiter Import, dem
    // das wirkungslose ON CONFLICT nicht im Weg stand).
    //
    // Also zwei Kopien mit derselben Zahl, und der Katalog ist mit IHR einig.
    doppelt: `
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,6);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,6,'set' FROM users WHERE username='tm';
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,6,'set' FROM users WHERE username='tm'`,
    // Marcos haeufigster Fall, GEMESSEN: 4908 von 6684 Gruppen. Zwei Zeilen
    // mit VERSCHIEDENEN Zahlen, und die groessere ist die Katalogzahl. Auch
    // das muss durchlaufen — die Katalogzahl kommt im Bestand vor.
    doppeltEineTrifft: `
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,18);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,18,'set' FROM users WHERE username='tm';
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,5,'set' FROM users WHERE username='tm'`,
    // Und die Gegenrichtung: KEINE der beiden Zahlen ist die Katalogzahl.
    // Dann ist wirklich zu entscheiden, und die Migration haelt an. Mit der
    // alten Summenpruefung rutschte genau das DURCH (6 + 4 = 10).
    doppeltKeineTrifft: `
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,10);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,6,'set' FROM users WHERE username='tm';
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
        SELECT id,'75192-1','3001',4,4,'set' FROM users WHERE username='tm'`,
    // Doppelte, von denen nur EINE einen Lagerort traegt. Der muss die
    // Zusammenlegung ueberleben.
    doppeltEinOrt: `
      INSERT INTO storage_locations (user_id,name)
        SELECT id,'Estrich' FROM users WHERE username='tm';
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,6);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,storage_id)
        SELECT id,'75192-1','3001',4,6,'set',NULL FROM users WHERE username='tm';
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,storage_id)
        SELECT u.id,'75192-1','3001',4,6,'set',
               (SELECT id FROM storage_locations WHERE name='Estrich')
          FROM users u WHERE u.username='tm'`,
    // Und zwei VERSCHIEDENE Orte: Zusammengelegt kann nur einer bleiben, also
    // haelt die Migration an.
    doppeltZweiOrte: `
      INSERT INTO storage_locations (user_id,name)
        SELECT id,'Estrich' FROM users WHERE username='tm';
      INSERT INTO storage_locations (user_id,name)
        SELECT id,'Keller' FROM users WHERE username='tm';
      INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
        VALUES ('75192-1','3001',4,6);
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,storage_id)
        SELECT u.id,'75192-1','3001',4,6,'set',
               (SELECT id FROM storage_locations WHERE name='Estrich')
          FROM users u WHERE u.username='tm';
      INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source,storage_id)
        SELECT u.id,'75192-1','3001',4,6,'set',
               (SELECT id FROM storage_locations WHERE name='Keller')
          FROM users u WHERE u.username='tm'`,
    // Manuelle Position: Spalte 5, Erfassung 3. Die Spalte ist nachgelaufen.
    manuellDrift: `
      INSERT INTO parts (user_id,part_number,color_id,quantity,source)
        SELECT id,'3070b',0,5,'manual' FROM users WHERE username='tm';
      INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
        SELECT id,'3070b',0,3,1.0,'N' FROM users WHERE username='tm'`,
    // Und einig: 2 + 3 = 5.
    manuellStimmig: `
      INSERT INTO parts (user_id,part_number,color_id,quantity,source)
        SELECT id,'3070b',0,5,'manual' FROM users WHERE username='tm';
      INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
        SELECT id,'3070b',0,2,1.0,'N',NOW() - INTERVAL '2 days' FROM users WHERE username='tm';
      INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
        SELECT id,'3070b',0,3,1.0,'N',NOW() - INTERVAL '1 day' FROM users WHERE username='tm'`,
    // Set-FIGUR ohne Katalogzeile — derselbe Fall wie ohneKatalog, andere
    // Tabelle. Ohne ihn waere der Figuren-Zweig von Schritt 1 ungeprueft.
    figOhneKatalog: `
      INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
        SELECT id,'75192-1','sw0001',3,'set' FROM users WHERE username='tm'`,
  };

  const lauf = async (sql, lage) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(MIG_DIR).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0038')) break;
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('tm','x')`);
      await c.query(`INSERT INTO set_catalog (set_number,name) VALUES ('75192-1','Falcon')`);
      await c.query(`INSERT INTO sets (user_id,set_number)
                     SELECT id,'75192-1' FROM users WHERE username='tm'`);
      await c.query(`INSERT INTO set_acquisitions (user_id,set_number,quantity,condition)
                     SELECT id,'75192-1',1,'N' FROM users WHERE username='tm'`);
      await c.query(LAGEN[lage]);
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('COMMIT'); return null; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return e.message; }
    } finally { c.release(); }
  };

  const katalogzahl = async () => (await db.get(
    `SELECT quantity FROM set_parts_catalog WHERE set_number='75192-1' AND part_number='3001'`
  ))?.quantity;
  const zeilen = async (tab) => (await db.get(`SELECT COUNT(*)::int c FROM ${tab}`)).c;

  // ── Lauf 1: fehlende Katalogzeile wird nachgetragen ──────────────────────
  assert.equal(await lauf(skript, 'ohneKatalog'), null,
    'Die Migration muss auf dieser Lage durchlaufen — Schritt 1 traegt die ' +
    'fehlende Katalogzeile ja gerade nach');
  assert.equal(Number(await katalogzahl()), 4,
    `Die Stueckzahl ist beim Umzug verloren gegangen: ${await katalogzahl()} statt 4`);
  assert.ok(!(await spaltenVon('parts')).includes('quantity'),
    'Schritt 4 hat die Spalte nicht geloescht');

  // ── Lauf 2: ohne Schritt 1 muss der Riegel greifen ──────────────────────
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Schritt 1 wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag, 'ohneKatalog');
  assert.match(String(meldung), /1 Set-Teile haben keine Katalogzeile/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  assert.ok((await spaltenVon('parts')).includes('quantity'),
    'parts.quantity ist trotz Abbruch weg — dann rollt die Transaktion nicht zurueck');
  assert.equal(Number((await db.get(`SELECT quantity FROM parts`)).quantity), 4,
    'Die Stueckzahl ist trotz Abbruch verschwunden');

  // ── Lauf 3: GEGENPROBE — ohne Schritt 1 UND ohne Riegel ─────────────────
  //
  // Der Kern. Lauf 2 zeigt nur, dass es knallt; erst dieser Lauf zeigt, dass
  // der RIEGEL den Verlust verhindert — und nicht Postgres, nicht die
  // Reihenfolge, nicht ein Zufall.
  const ohneBeides = ohneNachtrag.replace(riegel, '');
  assert.notEqual(ohneBeides, ohneNachtrag, 'Der Riegel wurde nicht herausgeschnitten');
  assert.equal(await lauf(ohneBeides, 'ohneKatalog'), null,
    'Ohne den Riegel muss die Datei durchlaufen — sonst beweist Lauf 2 nichts');
  assert.ok(!(await spaltenVon('parts')).includes('quantity'),
    'Ohne Riegel muss die Spalte geloescht sein — sonst beweist Lauf 2 nichts');
  assert.equal(await katalogzahl(), undefined,
    'Ohne Schritt 1 darf es die Katalogzeile NICHT geben — die 4 stand nur auf ' +
    'der Bestandszeile und ist damit restlos weg. Die Liste zeigte danach 1 ' +
    '(der Rueckfallwert von teilmengeAus), und nichts haette gewarnt.');

  // ── Lauf 4: der DRIFT ───────────────────────────────────────────────────
  const driftMeldung = await lauf(skript, 'drift');
  assert.match(String(driftMeldung), /Bei 1 Set-Teilen kommt die Katalogzahl im Bestand nicht vor/,
    `Der Drift-Riegel hat nicht gegriffen. Postgres sagte: ${driftMeldung}`);
  assert.match(String(driftMeldung), /75192-1 \/ 3001 Farbe 4/,
    'Die Meldung nennt kein Beispiel — „1 Zeile weicht ab" sagt nicht, wo man nachsieht');
  assert.match(String(driftMeldung), /Bestand 10, Katalog 6/,
    'Die Meldung nennt die beiden Zahlen nicht — dann kann der Mensch nicht entscheiden');
  assert.ok((await spaltenVon('parts')).includes('quantity'),
    'parts.quantity ist trotz Drift-Abbruch weg — dann rollt die Transaktion nicht zurueck');

  // ── Lauf 5: GEGENPROBE zum Drift ────────────────────────────────────────
  //
  // Dieselbe Lage, aber Abschrift und Katalog stimmen ueberein: Dann muss die
  // Migration durchlaufen. Ohne diesen Lauf koennte der Riegel einfach immer
  // abbrechen, sobald eine Katalogzeile existiert.
  assert.equal(await lauf(skript, 'stimmig'), null,
    'Bei uebereinstimmender Abschrift und Katalogzahl muss die Migration ' +
    'durchlaufen — sonst bricht der Riegel nicht beim Drift ab, sondern immer');
  assert.equal(Number(await katalogzahl()), 6, 'Die Katalogzahl wurde veraendert');

  // ── Lauf 6: der Drift einer MANUELLEN Position ──────────────────────────
  const manMeldung = await lauf(skript, 'manuellDrift');
  assert.match(String(manMeldung),
    /Bei 1 manuellen Teilen weicht quantity von der Summe der Erfassungen ab/,
    `Der Riegel prueft die manuellen Positionen nicht. Postgres sagte: ${manMeldung}`);
  // Und die Gegenprobe: 2 + 3 = 5 laeuft durch.
  assert.equal(await lauf(skript, 'manuellStimmig'), null,
    'Bei uebereinstimmender Spalte und Erfassungssumme muss die Migration durchlaufen');

  // ── Lauf 7: Doppelte, beide mit der Katalogzahl einig ───────────────────
  assert.equal(await lauf(skript, 'doppelt'), null,
    'Zwei Kopien derselben Zahl, mit der der Katalog einig ist, muessen ' +
    'durchlaufen — da ist nichts zu entscheiden');
  assert.equal(await zeilen('parts'), 1,
    'Schritt 3 hat die doppelte Zeile nicht zusammengelegt — ab Schritt 4 liest ' +
    'jede Zeile dieselbe Katalogzahl, zwei Zeilen zaehlten also doppelt (12 statt 6)');
  assert.equal(Number(await katalogzahl()), 6, 'Die Katalogzahl wurde veraendert');
  assert.ok((await indizes()).includes('idx_parts_eindeutig'),
    'Schritt 5 hat den eindeutigen Index nicht angelegt');

  // ── Lauf 7b: Marcos haeufigster Fall ────────────────────────────────────
  //
  // GEMESSEN auf seiner Installation: 4908 von 6684 Gruppen tragen zwei
  // verschiedene Zahlen, und die groessere ist die Katalogzahl. Die alte
  // Summenpruefung meldete das als Verlust („Bestand 23, Katalog 18") und
  // hielt die Migration fuer immer an — obwohl die 18 im Bestand steht.
  assert.equal(await lauf(skript, 'doppeltEineTrifft'), null,
    'Wenn eine der Zeilen die Katalogzahl traegt, muss die Migration ' +
    'durchlaufen. Die zweite Zahl ist der Rest eines aelteren Imports.');
  assert.equal(await zeilen('parts'), 1, 'Schritt 3 hat nicht zusammengelegt');
  assert.equal(Number(await katalogzahl()), 18, 'Die Katalogzahl wurde veraendert');

  // ── Lauf 7c: und wenn KEINE der Zahlen die Katalogzahl ist ──────────────
  //
  // Die Gegenrichtung zu 7b, und zugleich die Luecke der alten Fassung: 6 + 4
  // ergibt 10, also sah die Summenpruefung hier NICHTS — obwohl weder 6 noch
  // 4 die 10 ist und wirklich zu entscheiden war.
  const keineMeldung = await lauf(skript, 'doppeltKeineTrifft');
  assert.match(String(keineMeldung),
    /Bei 1 Set-Teilen kommt die Katalogzahl im Bestand nicht vor/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${keineMeldung}`);
  assert.match(String(keineMeldung), /Bestand 4, 6, Katalog 10/,
    'Die Meldung nennt nicht ALLE Zahlen des Bestands. „Bestand 10" waere hier ' +
    'die irrefuehrendste Auskunft von allen — es ist die Summe, die niemand hat.');
  assert.ok((await spaltenVon('parts')).includes('quantity'),
    'parts.quantity ist trotz Abbruch weg — dann rollt die Transaktion nicht zurueck');

  // ── Lauf 7d: der Lagerort ueberlebt das Zusammenlegen ───────────────────
  //
  // Die kleinste id bleibt, aber sie ist nicht unbedingt die Zeile mit dem
  // Lagerort. Ohne Schritt 3a waere er stumm weg: Der Vorrat (Migration 0031)
  // zeigte den Ort weiter, nur stuende kein Teil mehr darin.
  assert.equal(await lauf(skript, 'doppeltEinOrt'), null,
    'Doppelte, von denen eine einen Lagerort traegt, muessen durchlaufen');
  const mitOrt = await db.get(
    `SELECT l.name FROM parts p LEFT JOIN storage_locations l ON l.id = p.storage_id
      WHERE p.part_number='3001'`);
  assert.equal(mitOrt?.name, 'Estrich',
    `Der Lagerort hat das Zusammenlegen nicht ueberlebt (${JSON.stringify(mitOrt?.name)}). ` +
    'Die bleibende Zeile hatte keinen, die geloeschte schon.');

  // ── Lauf 7e: zwei VERSCHIEDENE Orte sind eine Entscheidung ──────────────
  const orteMeldung = await lauf(skript, 'doppeltZweiOrte');
  assert.match(String(orteMeldung), /liegen an VERSCHIEDENEN Lagerorten/,
    `Der Lagerort-Riegel hat nicht gegriffen. Postgres sagte: ${orteMeldung}`);
  assert.match(String(orteMeldung), /Estrich, Keller|Keller, Estrich/,
    'Die Meldung nennt die Orte nicht — dann kann der Mensch nicht entscheiden');
  assert.equal(await zeilen('parts'), 2,
    'Nach dem Abbruch muessen beide Zeilen noch da sein');

  // ── Lauf 8: GEGENPROBE zum Zusammenlegen ────────────────────────────────
  //
  // Ohne Schritt 3 kann Schritt 5 den eindeutigen Index nicht anlegen —
  // Postgres lehnt ihn ab, solange die Doppelung steht. Das beweist beides in
  // einem: dass Schritt 3 noetig ist, und dass Schritt 5 ohne ihn nicht
  // stillschweigend ausfiele.
  const ohneZusammen = skript.replace(zusammen, '');
  assert.notEqual(ohneZusammen, skript, 'Schritt 3 wurde nicht herausgeschnitten');
  // Dieselbe Lage wie Lauf 7 (zwei Kopien, Katalog einig) — nur ohne das
  // Zusammenlegen.
  const doppeltMeldung = await lauf(ohneZusammen, 'doppelt');
  assert.match(String(doppeltMeldung), /could not create unique index|duplicate key/,
    `Ohne Schritt 3 muss der eindeutige Index abgelehnt werden. Postgres sagte: ${doppeltMeldung}`);
  assert.equal(await zeilen('parts'), 2,
    'Nach dem Abbruch muessen beide Zeilen noch da sein — sonst rollt die ' +
    'Transaktion nicht zurueck');

  // ── Lauf 9: die FIGUREN, eigener Zweig ──────────────────────────────────
  assert.equal(await lauf(skript, 'figOhneKatalog'), null,
    'Der Figuren-Zweig von Schritt 1 traegt die fehlende Katalogzeile nicht nach');
  const figZahl = await db.get(
    `SELECT quantity FROM set_minifigs_catalog WHERE set_number='75192-1' AND fig_number='sw0001'`);
  assert.equal(Number(figZahl?.quantity), 3,
    `Die Stueckzahl der Figur ist verloren gegangen: ${figZahl?.quantity} statt 3`);
  assert.ok(!(await spaltenVon('minifigs')).includes('quantity'),
    'minifigs.quantity ist nach der Migration noch da');
});

test('niemand schreibt die Stückzahl eines Teils oder einer Figur mehr', () => {
  // Nur der QUELLTEXT, und nur die SCHREIBseite. Die Leseseite prueft nicht
  // dieser Test, sondern die Datenbank: Nach Migration 0038 gibt es die
  // Spalten nicht, jede verbliebene Lesestelle ist ein harter Fehler — und
  // genau deshalb laufen die Lesewege im naechsten Fall gegen eine migrierte
  // Datenbank, statt hier gegen ein Muster.
  const dateien = [];
  const lauf = (verz) => {
    for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
      const p = path.join(verz, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (/\.(ts|js)$/.test(e.name)) dateien.push(p);
    }
  };
  for (const teil of ['routes', 'utils', 'jobs', 'db', 'clients', 'scripts']) {
    const v = path.join(ROOT, teil);
    if (fs.existsSync(v)) lauf(v);
  }
  dateien.push(path.join(ROOT, 'server.ts'));
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden — der Pfad stimmt nicht`);

  // Zeilen ohne Kommentare: Ein Erklaertext, der eine Anweisung ZITIERT, ist
  // kein Schreibzugriff. Genau diese Falle hat in diesem Baum schon eine Regel
  // ihren eigenen Begruendungstext melden lassen — und die Kommentare in
  // utils/setMove.ts und db/migrations/0038 zitieren die entfernten
  // Anweisungen woertlich.
  const codeZeilen = (txt) => txt.split('\n')
    .filter(z => { const t = z.trim(); return !(t.startsWith('//') || t.startsWith('*')
                                             || t.startsWith('/*') || t.startsWith('--')); });

  // Nur parts und minifigs. Die Katalog- und Erfassungstabellen schreiben ihre
  // quantity natuerlich fort — sie sind die Wahrheit, nicht die Abschrift.
  const muster = [
    ['setzt parts',        /UPDATE\s+parts\s+SET\s+[^;`']*\bquantity\s*=/i],
    ['setzt minifigs',     /UPDATE\s+minifigs\s+SET\s+[^;`']*\bquantity\s*=/i],
    ['parts bei Konflikt', /INSERT\s+INTO\s+parts\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i],
    ['figs bei Konflikt',  /INSERT\s+INTO\s+minifigs\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i],
    // Und die Spalten duerfen nicht wieder angelegt werden — ein
    // `ADD COLUMN quantity` brachte die Abschrift zurueck, ohne eine einzige
    // der Regeln darueber zu verletzen.
    ['legt parts an',      /ALTER\s+TABLE\s+parts\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i],
    ['legt minifigs an',   /ALTER\s+TABLE\s+minifigs\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i],
  ];

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    const txt = fs.readFileSync(datei, 'utf8');
    for (const z of codeZeilen(txt)) {
      for (const [was, m] of muster) {
        if (m.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(stellen, [],
    'Diese Stellen schreiben die Stueckzahl eines Teils oder einer Figur:\n  ' +
    stellen.join('\n  ') +
    '\nSie steht seit Migration 0038 im Set-Katalog (fuer source=set) bzw. in den ' +
    'Erfassungen (fuer source=manual). Eine Abschrift daneben laeuft auseinander — ' +
    'genau das war bei sets.quantity gemessen worden: 10 bei drei Erfassungen mit Summe 7.');

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // Die Muster finden jetzt nichts — das ist der Punkt, sagt aber allein noch
  // nicht, dass sie ueberhaupt etwas finden KOENNTEN. Also an Zeilen
  // nachgewiesen, die in genau dieser Form im Baum standen (die ersten drei
  // woertlich aus utils/bestandsmenge.ts und utils/partsImport.ts, Fassung vor
  // 0038).
  const proben = [
    ['UPDATE parts SET quantity = $1 WHERE user_id=$2', 'setzt parts'],
    ['UPDATE minifigs SET quantity = $2 WHERE user_id=$1', 'setzt minifigs'],
    [`INSERT INTO parts (user_id,part_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,part_number) DO UPDATE SET quantity = EXCLUDED.quantity`,
      'parts bei Konflikt'],
    [`INSERT INTO minifigs (user_id,fig_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,fig_number) DO UPDATE SET quantity = EXCLUDED.quantity`,
      'figs bei Konflikt'],
    ['ALTER TABLE parts ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1', 'legt parts an'],
    ['ALTER TABLE minifigs ADD COLUMN quantity INTEGER DEFAULT 1', 'legt minifigs an'],
  ];
  for (const [zeile, name] of proben) {
    const m = muster.find(([was]) => was === name)[1];
    assert.ok(m.test(zeile),
      `Das Muster „${name}" greift nicht mehr auf seine eigene Probe: ${zeile.slice(0, 60)}`);
  }
  // Und die Gegenrichtung: Was erlaubt ist, darf NICHT greifen. Ohne diese
  // Haelfte waere ein Muster, das auf jede Zeile passt, auch gruen.
  for (const zeile of [
    'UPDATE part_acquisitions SET quantity = quantity - $1 WHERE id=$2',
    'UPDATE minifig_acquisitions SET quantity = $1 WHERE id=$2',
    `INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    'UPDATE sets SET storage_id = $1 WHERE id=$2',
  ]) {
    for (const [was, m] of muster) {
      assert.ok(!m.test(zeile),
        `Das Muster „${was}" meldet eine erlaubte Zeile: ${zeile.trim().slice(0, 70)}`);
    }
  }
});

test('die Lesewege liefern die Stückzahl aus Katalog und Erfassungen',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await volleKette();

  const haupt = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('tmleser','x') RETURNING id`)).id;
  const kind = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('tmleser_kind','x') RETURNING id`)).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`,
    [haupt, kind]);
  const SN = '75192-1';

  // ── Die Lage ─────────────────────────────────────────────────────────────
  //
  // Beide Konten halten dasselbe Set, das Hauptkonto ZWEI Exemplare. Darin
  // steckt ein Teil sechsmal und eine Figur einmal. Daneben hält das
  // Hauptkonto eine manuelle Position mit zwei Erfassungen (2 + 3) und eine
  // manuelle Figur (2).
  //
  // Diese Lage trennt alles, was sich verwechseln lässt: Katalogzahl gegen
  // Erfassungssumme, Set-Zweig gegen manuellen Zweig, ein Konto gegen den
  // Haushalt, und die Multiplikation mit der Setmenge gegen ihr Ausbleiben
  // bei einer manuellen Position.
  await db.run(`INSERT INTO set_catalog (set_number,name,year,pieces)
                VALUES ($1,'Millennium Falcon',2017,7541)
                ON CONFLICT (set_number) DO NOTHING`, [SN]);
  await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2),($3,$2)`,
    [haupt, SN, kind]);
  // Verschiedene Tage: idx_set_acq_tag_zustand (Migration 0008) erlaubt je Konto, Set
  // und TAG nur eine Erfassung.
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                VALUES ($1,$2,2,100,'N', NOW() - INTERVAL '3 days'),
                       ($3,$2,1, 90,'N', NOW() - INTERVAL '2 days')`, [haupt, SN, kind]);

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2x4'), ('3070b','Tile 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES
                  ('3001',4,'Rot'), ('3070b',0,'Schwarz')
                ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES
                  ('sw0001','Han Solo'), ('fig-m','Eigenbau')
                ON CONFLICT (fig_number) DO NOTHING`);

  // Set-Teil: die Stückzahl steht EINMAL im Katalog des Sets — gemeinsam für
  // alle Konten, die das Set halten.
  await db.run(`INSERT INTO set_parts_catalog (set_number,part_number,color_id,quantity)
                VALUES ($1,'3001',4,6)`, [SN]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,source)
                VALUES ($1,$2,'3001',4,'set'), ($3,$2,'3001',4,'set')`, [haupt, SN, kind]);
  await db.run(`INSERT INTO set_minifigs_catalog (set_number,fig_number,quantity)
                VALUES ($1,'sw0001',1)`, [SN]);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,source)
                VALUES ($1,$2,'sw0001','set'), ($3,$2,'sw0001','set')`, [haupt, SN, kind]);

  // Manuelle Position: die Stückzahl ist die Summe ihrer Erfassungen.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                VALUES ($1,'3070b',0,'manual')`, [haupt]);
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                VALUES ($1,'3070b',0,2,0.50,'N', NOW() - INTERVAL '2 days'),
                       ($1,'3070b',0,3,0.60,'N', NOW() - INTERVAL '1 day')`, [haupt]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,source)
                VALUES ($1,'fig-m','manual')`, [haupt]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                VALUES ($1,'fig-m',2,9.00,'N')`, [haupt]);

  const P = _req('utils/handlers/parts.js');
  const M = _req('utils/handlers/minifigs.js');
  const S = _req('utils/handlers/stats.js');
  const SH = _req('utils/handlers/shared.js');

  // ── Kennzahlen, ein Konto ────────────────────────────────────────────────
  //
  // 6 im Set × 2 Exemplare = 12, dazu 5 manuell = 17. Die manuelle Position
  // darf NICHT mit der Setmenge multipliziert werden — sie gehört zu keinem
  // Set. Stünde hier 22, wäre genau das passiert.
  const st1 = await S.getStats([haupt]);
  assert.equal(Number(st1.total_parts), 17,
    `Ein Konto: 6 im Set × 2 Exemplare + 5 manuell = 17, bekam ${st1.total_parts}`);
  assert.equal(Number(st1.total_minifigs), 4,
    `Ein Konto: 1 im Set × 2 Exemplare + 2 manuell = 4, bekam ${st1.total_minifigs}`);

  // ── Kennzahlen, Haushalt ─────────────────────────────────────────────────
  //
  // Dazu das eine Exemplar des Kindes: 6 × 1 = 6, also 23. Die Katalogzahl ist
  // für beide Konten DIESELBE — das ist der Punkt des Umzugs: Vorher trug
  // jedes Konto seine eigene Abschrift, und zwei Abschriften derselben Zahl
  // können auseinanderlaufen.
  const st2 = await S.getStats([haupt, kind]);
  assert.equal(Number(st2.total_parts), 23,
    `Haushalt: 12 + 5 + 6 = 23, bekam ${st2.total_parts}`);
  assert.equal(Number(st2.total_minifigs), 5,
    `Haushalt: 2 + 2 + 1 = 5, bekam ${st2.total_minifigs}`);

  // ── Die Listen ───────────────────────────────────────────────────────────
  const liste = await P.getParts([haupt], { page_size: 60 });
  const zeileVon = (l, nr) => (l.parts || []).find(x => x.part_number === nr);
  assert.equal(Number(zeileVon(liste, '3001').total_quantity), 12,
    'Die Teileliste multipliziert die Katalogzahl nicht mit der Setmenge');
  assert.equal(Number(zeileVon(liste, '3070b').total_quantity), 5,
    'Die Teileliste liest die manuelle Position nicht aus den Erfassungen');
  // Der Treiber liefert BIGINT als ZEICHENKETTE. Ohne den ::int-Cast haengt
  // der JSON-Typ daran, welcher Zweig geantwortet hat — genau dieser Fehler
  // ist in utils/handlers/parts.ts schon einmal aufgeflogen.
  assert.equal(typeof zeileVon(liste, '3001').total_quantity, 'number',
    'total_quantity muss eine Zahl sein, keine Zeichenkette');

  const figListe = await M.getMinifigs([haupt], { page_size: 60 });
  const figVon = (l, nr) => (l.figs || []).find(x => x.fig_number === nr);
  assert.equal(Number(figVon(figListe, 'sw0001').total_quantity), 2,
    'Die Figurenliste multipliziert nicht mit der Setmenge');
  assert.equal(Number(figVon(figListe, 'fig-m').total_quantity), 2,
    'Die Figurenliste liest die manuelle Figur nicht aus den Erfassungen');

  assert.equal(Number((await M.getMinifigStats([haupt])).total_quantity), 4,
    'Die Figuren-Kennzahl rechnet nicht mit');
  // getPartsStats zaehlt ABSICHTLICH nur Set-Teile — manuell erfasste haben in
  // der Oberflaeche ihren eigenen Bereich (der Filter steht in
  // utils/partsSummary.ts und im Rueckfall darunter). Also 12, nicht 17. Diese
  // Zahl ist hier kein Nebenbefund: Stuende 17, zaehlte die Kennzahl die
  // manuelle Position doppelt zum eigenen Bereich dazu, und zwar je nachdem,
  // ob die Zusammenfassung gerade frisch ist — genau der sporadische
  // Unterschied, der schon einmal in api-parity aufgefallen ist.
  assert.equal(Number((await P.getPartsStats([haupt])).total_parts), 12,
    'Die Teile-Kennzahl zaehlt nur Set-Teile: 6 × 2 Exemplare = 12');

  // ── Die Listen der MANUELLEN Positionen ─────────────────────────────────
  const man = await P.getManualParts([haupt], haupt, { page_size: 60 });
  const manZeile = man.find(x => x.part_number === '3070b');
  assert.ok(manZeile, 'Die manuelle Position fehlt in der Liste');
  assert.equal(Number(manZeile.quantity), 5,
    `Manuelle Teileliste: 2 + 3 = 5, bekam ${manZeile.quantity}`);
  const manFig = (await M.getManualMinifigs([haupt], haupt, { page_size: 60 }))
    .find(x => x.fig_number === 'fig-m');
  assert.ok(manFig, 'Die manuelle Figur fehlt in der Liste');
  assert.equal(Number(manFig.quantity), 2, `Manuelle Figurenliste: 2, bekam ${manFig.quantity}`);

  // ── „Kann ich das bauen?" ───────────────────────────────────────────────
  //
  // getOwnedQuantities trennt GESAMT von LOSE: Ein Teil, das in einem Set
  // steckt, ist vorhanden, aber nicht greifbar. Genau diese Trennung braucht
  // die Fallunterscheidung an zwei Stellen in EINER Abfrage.
  const besitz = await P.getOwnedQuantities([haupt], [
    { part_number: '3001', color_id: 4 }, { part_number: '3070b', color_id: 0 },
  ]);
  assert.equal(besitz['3001|4']?.gesamt, 12, 'Set-Teil: 6 × 2 Exemplare');
  assert.equal(besitz['3001|4']?.lose, 0, 'Ein Teil im Set ist nicht lose');
  assert.equal(besitz['3070b|0']?.gesamt, 5, 'Manuelle Position: 2 + 3');
  assert.equal(besitz['3070b|0']?.lose, 5, 'Eine manuelle Position ist lose');

  // ── Der Dialog „in welchen Sets steckt das?" ────────────────────────────
  //
  // Hier zeigt sich die gemeinsame Katalogzahl am deutlichsten: Zwei Konten,
  // ein Set, EINE Zahl — und zwar die JE EXEMPLAR, ohne Multiplikation, weil
  // der Dialog das Set zeigt, nicht den Bestand.
  const verw = await SH.verwendendeSets([haupt, kind], 'parts',
    { part_number: '3001', color_id: 4 });
  assert.equal(verw.sets.length, 2,
    `Beide Konten halten das Set, erwartet zwei Zeilen, bekam ${verw.sets.length}`);
  for (const s of verw.sets) {
    assert.equal(Number(s.quantity), 6,
      `Jede Zeile muss die Katalogzahl 6 tragen, bekam ${s.quantity}`);
  }

  // ── Farben und Zusammenfassung ──────────────────────────────────────────
  const farben = await P.getPartsColors([haupt]);
  assert.ok(Array.isArray(farben) && farben.length > 0,
    'Die Farbliste ist leer — sie zaehlt mit teilmengeAus() und muesste zwei Farben haben');

  // rebuildNow() und nicht rebuild(): Die Listenaufrufe darueber haben ueber
  // ensureFresh() schon einen HINTERGRUNDaufbau angestossen, und der haelt
  // die Sperre pg_try_advisory_xact_lock. rebuild() direkt gerufen sieht die
  // Sperre, kehrt stillschweigend zurueck („ein anderer baut gerade") und baut
  // nichts — GEMESSEN: parts_summary war danach LEER. rebuildNow() wartet auf
  // den laufenden Aufbau, statt daneben einen zweiten zu versuchen.
  const { rebuildNow } = _req('utils/partsSummary.js');
  await rebuildNow(haupt);
  const zus = await db.get(
    `SELECT total_quantity FROM parts_summary WHERE user_id=$1 AND part_number='3001'`,
    [haupt]);
  assert.ok(zus, 'Die Zusammenfassung hat das Set-Teil nicht aufgenommen');
  assert.equal(Number(zus.total_quantity), 12,
    `Die vorberechnete Zahl ist 6 × 2 = 12, bekam ${zus.total_quantity}`);

  // ── Bewertung und CSV ───────────────────────────────────────────────────
  //
  // Beide tragen die Fallunterscheidung ebenfalls. Hier wird nur AUSGEFÜHRT
  // und auf die Stückzahl gesehen — der Geldbetrag haengt an den Marktpreisen
  // und ist Sache von test/bewertung-abfragen-db.test.js.
  // Beide Bewertungen rechnen NUR die manuellen Positionen — ein Set-Teil
  // wird ueber sein Set bewertet, nicht einzeln (die Bedingung
  // `p.source = 'manual'` steht in utils/finance/bewertung.ts). Also auf die
  // manuelle Position gesehen; deren Stueckzahl ist die Erfassungssumme.
  const B = _req('utils/finance/bewertung.js');
  const bewP = await B.computePartsValuation(haupt, [haupt]);
  const bewZeile = (bewP.parts || []).find(x => x.part_number === '3070b');
  assert.ok(bewZeile,
    `Die Teile-Bewertung kennt die manuelle Position nicht: ${JSON.stringify(bewP).slice(0, 200)}`);
  assert.equal(Number(bewZeile.quantity), 5,
    `Die Bewertung liest 2 + 3 = 5, bekam ${bewZeile.quantity}`);
  assert.ok(!(bewP.parts || []).some(x => x.part_number === '3001'),
    'Das Set-Teil steht in der Teile-Bewertung — dann wird es zweimal bewertet, ' +
    'einmal hier und einmal ueber sein Set');
  const bewM = await B.computeMinifigsValuation(haupt, [haupt]);
  const bewFig = (bewM.figs || []).find(x => x.fig_number === 'fig-m');
  assert.ok(bewFig,
    `Die Figuren-Bewertung kennt die manuelle Figur nicht: ${JSON.stringify(bewM).slice(0, 200)}`);
  assert.equal(Number(bewFig.quantity), 2,
    `Die Figuren-Bewertung liest 2, bekam ${bewFig.quantity}`);

  const csvP = await _req('routes/parts.js').buildPartsCsv(haupt);
  assert.match(csvP, /3070b/, 'Der Teile-Export laesst die manuelle Position aus');
  const csvM = await _req('routes/minifigs.js').buildFigsCsv(haupt);
  assert.match(csvM, /fig-m/, 'Der Figuren-Export laesst die manuelle Figur aus');

  // ── GEGENPROBE 1: die KATALOGZAHL ändern ────────────────────────────────
  //
  // Der Kern dieses Falls. Ohne ihn könnten alle Zahlen oben zufällig stimmen
  // — etwa aus einer anderen Quelle, die gerade dasselbe sagt. Erst wenn die
  // Antwort einer Änderung FOLGT, ist bewiesen, woher sie kommt. Und sie muss
  // bei BEIDEN Konten folgen: Der Katalog ist gemeinsam.
  await db.run(`UPDATE set_parts_catalog SET quantity = 9
                 WHERE set_number=$1 AND part_number='3001'`, [SN]);
  assert.equal(Number((await S.getStats([haupt])).total_parts), 23,
    'Nach 6 → 9 muss ein Konto 9 × 2 + 5 = 23 zaehlen — dann liest die Kennzahl ' +
    'die Zahl nicht aus set_parts_catalog');
  assert.equal(Number((await S.getStats([kind])).total_parts), 9,
    'Das Kind muss der GEMEINSAMEN Katalogzahl ebenso folgen: 9 × 1 = 9');
  assert.equal(Number(zeileVon(await P.getParts([haupt], { page_size: 60 }), '3001').total_quantity), 18,
    'Die Liste folgt der Katalogzahl nicht: 9 × 2 = 18');

  // ── GEGENPROBE 2: eine ERFASSUNG ändern ─────────────────────────────────
  //
  // Dieselbe Probe für den anderen Zweig. Dass beide Gegenproben gebraucht
  // werden, ist der ganze Grund, warum teilmengeAus() eine FALLunterscheidung
  // ist und keine einzelne Abfrage.
  const eine = await db.get(
    `SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number='3070b'
      ORDER BY id ASC LIMIT 1`, [haupt]);
  await db.run(`UPDATE part_acquisitions SET quantity = 7 WHERE id=$1`, [eine.id]);
  assert.equal(Number(zeileVon(await P.getParts([haupt], { page_size: 60 }), '3070b').total_quantity), 10,
    'Nach 2 → 7 muss die manuelle Position 10 sein (7 + 3) — dann liest die Liste ' +
    'sie nicht aus part_acquisitions');

  // ── Und ohne Erfassung ist die Menge 0, nicht 1 ─────────────────────────
  //
  // Eine manuelle Bestandszeile ohne Erfassung sollte es nicht geben
  // (Migration 0035 traegt fuer jede eine nach), aber sie darf die Liste
  // nicht LEEREN — deshalb LEFT JOIN in utils/bestandsmenge.ts. Sie bedeutet
  // dann null Stueck, nicht eines.
  await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number='3070b'`,
    [haupt]);
  const leer = zeileVon(await P.getParts([haupt], { page_size: 60 }), '3070b');
  assert.ok(leer, 'Die Zeile ohne Erfassung ist aus der Liste verschwunden — ein ' +
    'INNER JOIN statt LEFT JOIN leert den Bestand, statt 0 zu zeigen');
  assert.equal(Number(leer.total_quantity), 0,
    `Ohne Erfassung sind es 0 Stueck, nicht ${leer.total_quantity} — der ` +
    'Rueckfallwert 1 gilt nur fuer den SET-Zweig (ein Set-Teil steckt mindestens einmal drin)');
});
