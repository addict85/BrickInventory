/**
 * „Kann ich das bauen?" — was der Bestandsabgleich zählt.
 *
 * Gegenprobe (durchgeführt): den LEFT JOIN samt Multiplikation zurück auf
 * `SUM(p.quantity)` gesetzt → Schritt 1 wird rot, die anderen bleiben grün.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
const { getOwnedQuantities } = _req('src/teile/abfragen.js');
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');

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
  await haeltSet(db, UID, '60052-1', 2);
  await haeltSet(db, UID, '10276-1', 1);

  // Teile AUS den Sets (source bleibt leer — genau wie partsImport.ts sie legt).
  const setTeil = async (setNr, num, farbe, menge) => {
    // Beschreibung in den Katalog, Bestand in parts (Migration 0034).
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ($1,'Brick')
                  ON CONFLICT (part_number) DO NOTHING`, [num]);
    await haeltTeil(db, UID, num, { setNumber: setNr, menge: menge, colorId: farbe });
  };
  await setTeil('60052-1', '3001', 0, 3);   // 3 je Bausatz, zweimal besessen → 6
  await setTeil('10276-1', '3002', 0, 5);   // 5 je Bausatz, einmal besessen  → 5

  // Manuell erfasst: haengt an keinem Set.
  await haeltTeil(db, UID, '3003', { menge: 7, colorId: 0 });

  // Teilezeile, deren Set nicht (mehr) in `sets` steht — der LEFT-JOIN-Fall.
  await setTeil('99999-1', '3004', 0, 4);

  // Minifiguren: eine aus dem zweimal besessenen Set, eine manuell erfasste.
  await haeltFigur(db, UID, 'trn241', { setNumber: '60052-1', menge: 1 });
  await haeltFigur(db, UID, 'cty0500', { menge: 2 });
}

async function dbErreichbar() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Bestandsabgleich der Teileliste', { concurrency: 1 }, async (t) => {
  if (!(await dbErreichbar())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
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
  assert.match(src, /const pkey = `\$\{(?:esc\()?p\.part_number\)?\}__\$\{p\.color_id\|\|0\}`/,
    'Die Bestandsabfrage fragt nicht mehr mit der Rebrickable-Nummer');

  // Und die Anzeige bleibt BrickLink — genau Marcos Vorgabe.
  assert.ok(src.includes('data-part="${p.bl_part_number||p.part_number}"'),
    'Die Anzeige zeigt nicht mehr die BrickLink-Nummer');
});

/**
 * Das Blickfeld des Abgleichs kommt aus DIESER Ansicht.
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
