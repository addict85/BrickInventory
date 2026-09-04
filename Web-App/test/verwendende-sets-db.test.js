/**
 * Welche Sets verwenden dieses Teil / diese Figur?
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Auch die automatisch erfassten Teile und Minifiguren sollen einen
 * Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden, die
 * Anzahl soll nicht geändert werden können. Dafür soll angezeigt werden,
 * welche Sets dieses Teil und Minifigur verwenden — inkl. Link, um den
 * Detail-Dialog des Sets öffnen zu können."
 *
 * ── Warum gegen die echte Datenbank ─────────────────────────────────────────
 * Die Antwort entsteht aus einer Verknüpfung über zwei Tabellen, einer
 * Gruppierung und einer Summe. Ein Test mit Attrappe prüfte davon nichts —
 * gerade die Summe je Set und die Trennung „aus einem Set" gegen „manuell
 * erfasst" sind die Stellen, an denen so etwas schiefgeht.
 *
 * ── Was hier ausdrücklich mitgeprüft wird ───────────────────────────────────
 *  1. Blickfeld: Im Haushalt gehört auch das Set des Geschwisterkontos dazu.
 *     Sonst sagte der Dialog etwas anderes als die Teileliste darüber, aus der
 *     man kommt.
 *  2. Manuell erfasste Positionen tauchen NICHT auf. Sie haben keine
 *     Set-Nummer, und ein Eintrag ohne Set wäre in dieser Liste sinnlos.
 *  3. Teile und Figuren gehen durch DIESELBE Funktion. Beide werden geprüft —
 *     sonst könnte eine Seite still auseinanderlaufen, und genau das ist in
 *     diesem Projekt zwischen routes/parts.ts und routes/minifigs.ts schon
 *     passiert.
 *
 * Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { verwendendeSets } = _req('utils/handlers/shared.js');

async function erreichbar() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

after(() => db.pool.end());

test('die Liste der verwendenden Sets folgt dem Blickfeld', async (t) => {
  if (!await erreichbar()) {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('haupt'), kind = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES
      ($1,'75192-1','Millennium Falcon',1),
      ($1,'10305-1','Löwenritterburg',1),
      ($2,'21058-1','Cheops-Pyramide',1)`, [haupt, kind]);

  // Dasselbe Teil in drei Sets — zweimal beim Hauptkonto, einmal beim Kind.
  // Im ersten Set steht es ZWEIMAL (zwei Zeilen), damit die Summe je Set
  // etwas zu tun bekommt: Ohne die Gruppierung stünde 75192-1 doppelt da.
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,part_name,color_id,color_name,quantity,source) VALUES
      ($1,'75192-1','3001','Brick 2x4',4,'Rot',10,'set'),
      ($1,'75192-1','3001','Brick 2x4',4,'Rot', 5,'set'),
      ($1,'10305-1','3001','Brick 2x4',4,'Rot', 7,'set'),
      ($2,'21058-1','3001','Brick 2x4',4,'Rot', 3,'set'),
      ($1,'75192-1','3001','Brick 2x4',1,'Blau',99,'set')`, [haupt, kind]);

  // Manuell erfasst: KEINE Set-Nummer. Darf nicht auftauchen.
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,part_name,color_id,color_name,quantity,source)
      VALUES ($1,NULL,'3001','Brick 2x4',4,'Rot',42,'manual')`, [haupt]);

  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,fig_name,quantity,source) VALUES
      ($1,'75192-1','sw0001','Han Solo',2,'set'),
      ($2,'21058-1','sw0001','Han Solo',1,'set')`, [haupt, kind]);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,fig_name,quantity,source)
      VALUES ($1,NULL,'sw0001','Han Solo',9,'manual')`, [haupt]);

  // ── Teil, Blickfeld des Hauptkontos (Haushalt) ───────────────────────────
  const { item, sets: imHaushalt } = await verwendendeSets([haupt, kind], 'parts',
    { part_number: '3001', color_id: 4 });
  assert.deepEqual(imHaushalt.map(s => s.set_number), ['10305-1', '21058-1', '75192-1'],
    `Erwartet drei Sets in Nummernfolge, bekam ${JSON.stringify(imHaushalt.map(s => s.set_number))}`);

  const nach = Object.fromEntries(imHaushalt.map(s => [s.set_number, s]));
  assert.equal(nach['75192-1'].quantity, 15,
    'Zwei Zeilen desselben Teils im selben Set müssen zusammengezählt werden');
  assert.equal(nach['10305-1'].quantity, 7);
  assert.equal(nach['21058-1'].quantity, 3);
  assert.equal(nach['21058-1'].owner_user_id, kind,
    'Der Besitzer muss mitkommen — im Haushalt steht sonst nicht da, wem das Set gehört');
  assert.equal(nach['75192-1'].set_name, 'Millennium Falcon',
    'Ohne den Namen steht im Dialog nur eine Nummer');

  // Die manuelle Position (42 Stück, ohne Set) darf in keiner Summe stecken.
  const summe = imHaushalt.reduce((n, s) => n + s.quantity, 0);
  assert.equal(summe, 25, `Summe ${summe} — die manuell erfasste Zeile ist mitgezählt worden`);

  // ── Die FARBE trennt ─────────────────────────────────────────────────────
  const blau = (await verwendendeSets([haupt, kind], 'parts', { part_number: '3001', color_id: 1 })).sets;
  assert.deepEqual(blau.map(s => [s.set_number, s.quantity]), [['75192-1', 99]],
    'Die Farbe wird nicht unterschieden — dann zeigt der Dialog fremde Bestände');

  // ── Einzelkonto sieht nur sein eigenes Set ───────────────────────────────
  const nurKind = (await verwendendeSets([kind], 'parts', { part_number: '3001', color_id: 4 })).sets;
  assert.deepEqual(nurKind.map(s => s.set_number), ['21058-1'],
    'Ohne Haushalt darf nur das eigene Set erscheinen');

  // ── Figuren: dieselbe Funktion, dieselben Regeln ─────────────────────────
  const { item: figItem, sets: figuren } = await verwendendeSets([haupt, kind], 'minifigs', { fig_number: 'sw0001' });
  assert.deepEqual(figuren.map(s => [s.set_number, s.quantity]),
    [['21058-1', 1], ['75192-1', 2]],
    'Für Figuren gilt dasselbe — inklusive: die manuell erfasste zählt nicht mit');

  // ── Der Kopf des Dialogs kommt aus DENSELBEN Zeilen ─────────────────────
  //
  // Eine zweite Abfrage für Name, Farbe und Bild könnte etwas anderes sagen
  // als die Liste darunter. Deshalb wird beides aus einem Durchgang gebildet —
  // und deshalb wird hier beides geprüft.
  assert.equal(item.nummer, '3001');
  assert.equal(item.name, 'Brick 2x4');
  assert.equal(item.color_name, 'Rot');
  assert.equal(item.total_quantity, 25,
    'Die Gesamtmenge muss die Summe der Sets sein — und die manuelle Zeile NICHT enthalten');
  assert.equal(item.is_spare, false,
    'is_spare kommt als INTEGER; "0" ist in JavaScript WAHR — hier muss ein echter Wahrheitswert stehen');

  assert.equal(figItem.nummer, 'sw0001');
  assert.equal(figItem.name, 'Han Solo');
  assert.equal(figItem.color_name, null,
    'Figuren haben keine Farbe — das Feld muss trotzdem dastehen, damit beide Antworten dieselbe Form haben');
  assert.equal(figItem.total_quantity, 3);

  // Selbstbeweis: Wäre die Abfrage kaputt und lieferte gar nichts, wären alle
  // deepEqual oben gegen leere Listen gelaufen — die erste hätte es gemeldet.
  // Diese Zeile hält zusätzlich fest, dass BEIDE Seiten etwas geliefert haben.
  assert.ok(imHaushalt.length >= 3 && figuren.length >= 2,
    'Eine der beiden Abfragen hat nichts geliefert');
});

test('eine unerlaubte Spalte wird abgewiesen', async (t) => {
  if (!await erreichbar()) { t.skip('keine Test-DB'); return; }
  // Der Spaltenname wird in den Abfragetext eingefügt — als Parameter geht das
  // nicht. Die Namen kommen aus Literalen der beiden Routen, nie aus einer
  // Anfrage; die Schranke steht trotzdem, damit ein künftiger Aufrufer nichts
  // anderes einsetzen kann.
  await assert.rejects(
    () => verwendendeSets([1], 'parts', { 'part_number; DROP TABLE parts': 'x' }),
    /unerlaubte Spalte/,
    'Ein beliebiger Spaltenname ging durch');
});
