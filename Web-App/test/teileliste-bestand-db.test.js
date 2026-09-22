/**
 * „Kann ich das bauen?" — was der Bestandsabgleich zählt.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Ich besitze das Set 2x wie kann es dann sein, dass Teile fehlen?"
 *
 * Weil die Stückzahl nirgends vorkam. Der Teile-Import legt je
 * (user_id, set_number) GENAU EINEN Satz Zeilen ab (utils/partsImport.ts:
 * erst DELETE, dann INSERT mit `part.quantity`) — wie oft jemand das Set
 * besitzt, steht ausschliesslich in `sets.quantity`. Der Abgleich summierte
 * aber blank über `parts.quantity`. Wer ein Set zweimal hatte, sah den Inhalt
 * von einem.
 *
 * ── Warum mit DB ────────────────────────────────────────────────────────────
 *
 * Die Aussage ist eine Aussage über eine ABFRAGE mit zwei Tabellen und einem
 * LEFT JOIN. Am Quelltext lässt sich prüfen, dass der JOIN dasteht — nicht,
 * dass er das Richtige rechnet. Vier Fälle, die alle in einer einzigen Antwort
 * zusammenkommen müssen:
 *
 *   1. Ein Set, zweimal besessen  → Teile zählen doppelt.
 *   2. Ein Set, einmal besessen   → unverändert.
 *   3. Manuell erfasste Teile     → NIE multipliziert (sie hängen an keinem
 *                                    Set; `lose` ist genau diese Menge).
 *   4. Eine Teilezeile ohne Set   → zählt einfach, statt aus der Antwort zu
 *                                    fallen (deshalb LEFT und nicht INNER).
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 *
 * Gegenprobe (durchgeführt): den LEFT JOIN samt Multiplikation zurück auf
 * `SUM(p.quantity)` gesetzt → Schritt 1 wird rot, die anderen bleiben grün.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { getOwnedQuantities } = _req('utils/handlers/parts.js');

let UID = 0;

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('bauer','x')`);
  UID = (await db.get(`SELECT id FROM users WHERE username='bauer'`)).id;

  // Zwei Sets: eines zweimal besessen, eines einmal.
  await db.run(`INSERT INTO sets (user_id, set_number, name, quantity) VALUES ($1,'60052-1','Cargo Train',2)`, [UID]);
  await db.run(`INSERT INTO sets (user_id, set_number, name, quantity) VALUES ($1,'10276-1','Colosseum',1)`, [UID]);

  // Teile AUS den Sets (source bleibt leer — genau wie partsImport.ts sie legt).
  const setTeil = (setNr, num, farbe, menge) => db.run(
    `INSERT INTO parts (user_id, set_number, part_number, part_name, color_id, quantity)
     VALUES ($1,$2,$3,$4,$5,$6)`, [UID, setNr, num, 'Brick', farbe, menge]);
  await setTeil('60052-1', '3001', 0, 3);   // 3 je Bausatz, zweimal besessen → 6
  await setTeil('10276-1', '3002', 0, 5);   // 5 je Bausatz, einmal besessen  → 5

  // Manuell erfasst: haengt an keinem Set.
  await db.run(
    `INSERT INTO parts (user_id, part_number, part_name, color_id, quantity, source)
     VALUES ($1,'3003','Brick',0,7,'manual')`, [UID]);

  // Teilezeile, deren Set nicht (mehr) in `sets` steht — der LEFT-JOIN-Fall.
  await setTeil('99999-1', '3004', 0, 4);

  // Minifiguren: eine aus dem zweimal besessenen Set, eine manuell erfasste.
  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, fig_name, quantity)
     VALUES ($1,'60052-1','trn241','Train Driver',1)`, [UID]);
  await db.run(
    `INSERT INTO minifigs (user_id, fig_number, fig_name, quantity, source)
     VALUES ($1,'cty0500','Worker',2,'manual')`, [UID]);
}

async function dbErreichbar() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Bestandsabgleich der Teileliste', { concurrency: 1 }, async (t) => {
  if (!(await dbErreichbar())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') throw new Error('REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar.');
    t.skip('Test-DB nicht erreichbar');
    return;
  }
  await seed();
  t.after(async () => { await db.pool.end().catch(() => {}); });

  const frage = [
    { part_number: '3001', color_id: 0 },
    { part_number: '3002', color_id: 0 },
    { part_number: '3003', color_id: 0 },
    { part_number: '3004', color_id: 0 },
    // Die Teileliste haengt Minifiguren als eigene Zeilen an — mit der
    // FIGURENNUMMER als part_number und Farbe 0 (08-init.js, plGenerate).
    { part_number: 'trn241',  color_id: 0 },
    { part_number: 'cty0500', color_id: 0 },
  ];
  const bestand = await getOwnedQuantities([UID], frage);

  await t.test('ein zweimal besessenes Set liefert seine Teile doppelt', () => {
    assert.equal(bestand['3001|0']?.gesamt, 6,
      'Genau Marcos Befund: 3 Stück je Bausatz, das Set zweimal besessen — ' +
      `erwartet 6, bekommen ${bestand['3001|0']?.gesamt}. Zählt sets.quantity nicht mit?`);
    assert.equal(bestand['3001|0']?.lose, 0, 'Ein Set-Teil ist nicht „lose"');
  });

  await t.test('ein einmal besessenes Set bleibt, wie es war', () => {
    // Die Gegenrichtung: Die Multiplikation darf nicht aus jeder Zeile mehr
    // machen, sondern nur aus denen mit einer Stückzahl über eins.
    assert.equal(bestand['3002|0']?.gesamt, 5);
  });

  await t.test('manuell erfasste Teile werden NIE multipliziert', () => {
    assert.equal(bestand['3003|0']?.gesamt, 7);
    assert.equal(bestand['3003|0']?.lose, 7,
      'Manuell erfasste Teile sind genau das, was „nur manuell erfasste Teile" zählt');
  });

  await t.test('Minifiguren zaehlen mit — auch die aus Sets', () => {
    // Der Befund hinter dieser Prüfung: Gefragt wurde in `parts`, und dort
    // steht keine Figur. JEDE Minifigur einer Teileliste galt deshalb als
    // fehlend, auch wenn sie im Bestand stand — stillschweigend, denn „nicht
    // gefunden" sieht aus wie „habe ich nicht".
    assert.equal(bestand['trn241|0']?.gesamt, 2,
      'Die Figur steckt in einem zweimal besessenen Set — erwartet 2, bekommen ' +
      `${bestand['trn241|0']?.gesamt}. Wird die Tabelle minifigs gar nicht gelesen?`);
    assert.equal(bestand['trn241|0']?.lose, 0, 'Eine Figur aus einem Set ist nicht „lose"');
  });

  await t.test('manuell erfasste Figuren zaehlen als lose', () => {
    assert.equal(bestand['cty0500|0']?.gesamt, 2);
    assert.equal(bestand['cty0500|0']?.lose, 2);
  });

  await t.test('eine Teilezeile ohne Set faellt nicht aus der Antwort', () => {
    // Der Grund fuer LEFT statt INNER: Ein geloeschtes Set liesse seine
    // Teilezeilen sonst spurlos verschwinden — und der Abgleich meldete ein
    // Teil als fehlend, das dasteht.
    assert.equal(bestand['3004|0']?.gesamt, 4,
      'Ohne passende sets-Zeile wurde der Posten ganz weggejoint');
  });
});

/**
 * Beide Seiten des Abgleichs benutzen DIESELBE Nummer.
 *
 * ── Marcos Frage ────────────────────────────────────────────────────────────
 *
 * „Kann der Abgleich im Hintergrund nicht über die Rebrickable ID erfolgen,
 * die Anzeige aber weiterhin über die BrickLink ID?" — Ja. Und dass es das
 * vorher NICHT tat, war der zweite Grund für fehlende Teile.
 *
 * Zusammengefasst wurde der Bedarf nach der BrickLink-Nummer, nachgefragt
 * wurde der Bestand mit der Rebrickable-Nummer. Mehrere Rebrickable-Teile
 * teilen sich regelmässig eine BrickLink-Nummer (Formvarianten). Für die
 * fielen zwei Zeilen zu einer zusammen: Bedarf addiert, gesucht aber nur nach
 * der Nummer, die zufällig zuerst kam.
 *
 * `ohneKommentare()` ist hier keine Zierde: Der Erklärkommentar an der
 * geänderten Stelle zitiert die alte Fassung wörtlich. Ohne das Abstreifen
 * fände dieser Test sie und bliebe für immer grün — dieselbe Falle, die der
 * Helfer im Kopf beschreibt und die in dieser Sitzung schon einmal zugeschnappt
 * ist.
 *
 * Gegenprobe (durchgeführt): Schlüssel zurück auf `${blNum}|…` gesetzt →
 * dieser Schritt wird rot.
 */
test('Bedarf und Bestand werden über dieselbe Nummer zusammengeführt', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ohneKommentare } = require('./helpers/sources');
  const src = ohneKommentare(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '08-init.js'), 'utf8'));

  assert.match(src, /const key = `\$\{p\.part_number\}\|\$\{p\.color_id\|\|0\}`/,
    'Der Bedarf wird nicht (mehr) nach der Rebrickable-Nummer zusammengefasst. ' +
    'Fasst er nach der BrickLink-Nummer zusammen, laufen Formvarianten zu einer ' +
    'Zeile zusammen, deren Bestand nur für eine der beiden Nummern gesucht wird.');
  assert.ok(!/const key = `\$\{blNum\}/.test(src),
    'Der alte BrickLink-Schlüssel steht wieder da');

  // Die Nachfrage-Seite: derselbe Bestandteil, damit beide zusammenpassen.
  assert.match(src, /const pkey = `\$\{esc\(p\.part_number\)\}__\$\{p\.color_id\|\|0\}`/,
    'Die Bestandsabfrage fragt nicht mehr mit der Rebrickable-Nummer');

  // Und die Anzeige bleibt BrickLink — genau Marcos Vorgabe.
  assert.ok(src.includes('data-part="${esc(p.bl_part_number||p.part_number)}"'),
    'Die Anzeige zeigt nicht mehr die BrickLink-Nummer');
});

/**
 * Das Blickfeld des Abgleichs kommt aus DIESER Ansicht.
 *
 * Bis hierher übernahm `plFuelleBestand()` stillschweigend den Kontofilter des
 * TEILE-Reiters (`scopeQuery('parts')`) — eine Einstellung, die woanders sitzt
 * und hier wirkt. Nach jeder Anmeldung steht sie ausserdem auf „Alle Konten",
 * womit der Abgleich entgegen Marcos Vorgabe („aber nur die eigenen Sets")
 * immer den ganzen Haushalt zählte.
 *
 * Gegenprobe (durchgeführt): `scopeQuery('parts')` wieder eingesetzt → rot.
 */
test('der Bestandsabgleich liest sein Blickfeld aus der eigenen Wahl', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ohneKommentare } = require('./helpers/sources');
  const js = ohneKommentare(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '08-init.js'), 'utf8'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.ok(js.includes("G('pl-bestand-subs')"),
    'Die Wahl „Unterkonten mit einbeziehen" wird nicht gelesen');
  assert.ok(js.includes("'?accounts=own'"),
    'Ohne Haken muss `accounts=own` mitreisen — sonst zählt der Haushalt immer mit');
  assert.ok(!js.includes("scopeQuery('parts')"),
    'Der Abgleich hängt wieder am Kontofilter des Teile-Reiters. Der steht nach ' +
    'jeder Anmeldung auf „Alle Konten" und beantwortet hier eine Frage, die ' +
    'niemand an dieser Stelle gestellt hat.');
  assert.ok(html.includes('id="pl-bestand-subs"'), 'Die Wahl fehlt im Markup');
});
