/**
 * Die Teile-Bewertung darf nicht je Teil viermal nachfragen.
 *
 * ── Was gemessen wurde ──────────────────────────────────────────────────────
 *
 * Datenbank-Abfragen JE STÜCK, bei warmem Preis-Cache, 50 Stück je Art:
 *
 *     Sets           10 Abfragen   0,2 je Stück
 *     Minifiguren    55 Abfragen   1,1 je Stück
 *     Teile         205 Abfragen   4,1 je Stück      ← vorher
 *     Teile          57 Abfragen   1,1 je Stück      ← nachher
 *
 * Die drei überzähligen Fragen je Teil steckten in fetchPartPrice:
 *
 *     50x SELECT bl_color_id FROM rb_colors WHERE id=$1     ← 50x dieselbe Farbe
 *     50x SELECT bl_part_num FROM rb_bl_mapping WHERE …     ← einzeln statt ANY
 *     50x SELECT bl_part_number FROM parts WHERE …          ← dito, dazu ohne Index
 *
 * Abhilfe in utils/financeCalc.ts: die Farbtabelle als Ganzes merken
 * (farbkarte), die Teilenummern einer Bewertung vorladen (ladeBlNummernVor)
 * und in db/database.ts der Teilindex idx_parts_blnum.
 *
 * ── Warum dieser Test die ZÄHLUNG prüft und nicht die Zeit ──────────────────
 * Eine Zeitmessung im Testlauf sagt mehr über die Maschine als über den Code.
 * Die Zahl der Umläufe zur Datenbank ist dagegen eine Eigenschaft des Codes —
 * genau die, die hier kaputtgehen kann, wenn jemand das Vorladen entfernt oder
 * eine weitere Einzelabfrage in die Schleife legt.
 *
 * Gezählt wird am POOL, nicht an db.get/db.all: database.js exportiert seine
 * Funktionen als Getter (esbuild), sie sind von aussen nicht überschreibbar.
 * Ein Patch dort zählt still NICHTS mit — nachgemessen: 0 statt 205.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const fc = _req('utils/financeCalc.js');

const UID = 990101;
const N   = 20;               // genug, damit „je Stück" von „einmalig" trennbar ist
const NR  = i => `bwt-teil-${i}`;

// Alle Abfragen dieses Laufs mitschreiben.
const gesehen = [];
let zaehlen = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (zaehlen) {
    const sql = String(typeof text === 'string' ? text : (text && text.text) || '').replace(/\s+/g, ' ');
    gesehen.push(sql);
  }
  return altQuery(text, ...rest);
};
const wieOft = muster => gesehen.filter(q => muster.test(q)).length;

async function aufraeumen() {
  await db.run('DELETE FROM parts WHERE user_id = $1', [UID]).catch(() => {});
  await db.run('DELETE FROM part_price_cache WHERE part_number LIKE $1', ['bwt-teil-%']).catch(() => {});
  await db.run('DELETE FROM rb_bl_mapping WHERE part_num LIKE $1', ['bwt-teil-%']).catch(() => {});
  await db.run('DELETE FROM users WHERE id = $1', [UID]).catch(() => {});
}

test('Teile-Bewertung: kein Nachschlag je Teil', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id, username, password_hash) VALUES ($1, 'bwt_messnutzer', 'x')", [UID]);
    for (let i = 0; i < N; i++) {
      await db.run(
        "INSERT INTO parts (user_id, part_number, color_id, quantity, condition, source) VALUES ($1, $2, 4, 1, 'N', 'manual')",
        [UID, NR(i)]);
      // Der Betriebsfall: Der Nachtrag-Job hat die Nummer übersetzt.
      // bl_part_num == part_num, damit der Preis-Cache-Schlüssel gleich bleibt.
      await db.run(
        'INSERT INTO rb_bl_mapping (part_num, bl_part_num) VALUES ($1, $1) ON CONFLICT (part_num) DO UPDATE SET bl_part_num = EXCLUDED.bl_part_num',
        [NR(i)]);
      // Warmer Preis-Cache — der Normalfall. Ohne ihn misst man den
      // BrickLink-Abruf mit, den es beim zweiten Aufruf nicht mehr gibt.
      for (const zustand of ['N', 'U'])
        await db.run(
          `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
           VALUES ($1, 4, $2, 'EUR', 1.5, 1.4, NOW()) ON CONFLICT DO NOTHING`,
          [NR(i), zustand]);
    }
    // Farbtabelle: rb_colors wird als GANZES gemerkt. Ohne Zeile für Farbe 4
    // wäre die Karte leer und würde bewusst nicht gemerkt (siehe farbkarte).
    await db.run(
      'INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4, $1, 4) ON CONFLICT (id) DO UPDATE SET bl_color_id = 4',
      ['Rot']).catch(() => {});

    gesehen.length = 0;
    zaehlen = true;
    const ergebnis = await fc.computePartsValuation(UID, [UID]);
    zaehlen = false;

    assert.equal(ergebnis.parts.length, N, 'alle Teile bewertet');

    // ── 1. Keine EINZELabfrage je Teil mehr ────────────────────────────────
    assert.equal(wieOft(/FROM rb_bl_mapping WHERE part_num=\$1/), 0,
      `rb_bl_mapping wurde einzeln gefragt — das Vorladen (ladeBlNummernVor) greift nicht`);
    assert.equal(wieOft(/FROM parts WHERE part_number=\$1 AND bl_part_number/), 0,
      'der BL-Rückfall auf parts lief je Teil einzeln');

    // ── 2. Statt dessen genau eine Sammelabfrage ───────────────────────────
    assert.equal(wieOft(/FROM rb_bl_mapping WHERE part_num = ANY\(\$1\)/), 1,
      'die Sammelabfrage auf rb_bl_mapping fehlt oder lief mehrfach');

    // ── 3. Die Farbtabelle höchstens einmal ────────────────────────────────
    // Höchstens, nicht genau: Ein vorheriger Test im selben Prozess kann sie
    // bereits geladen haben, und dann ist Null die richtige Zahl.
    const farben = wieOft(/FROM rb_colors/);
    assert.ok(farben <= 1, `rb_colors wurde ${farben}x gefragt — erwartet höchstens 1x für alle Teile`);

    // ── 4. Die Gesamtzahl bleibt unter zwei Umläufen je Teil ───────────────
    // Gemessen: 1,1 je Teil (die Preis-Cache-Zeile plus ein paar einmalige).
    // Die Grenze steht bei 2, damit sie nicht bei jeder harmlosen Änderung
    // reisst — aber weit unter den 4,1 von vorher.
    assert.ok(gesehen.length < 2 * N,
      `${gesehen.length} Abfragen für ${N} Teile (${(gesehen.length / N).toFixed(1)} je Teil) — erwartet unter 2 je Teil`);

    // ── GEGENPROBE ────────────────────────────────────────────────────────
    // Sähe der Zähler die Einzelabfragen überhaupt? Ein Teil, das NICHT
    // vorgeladen wurde, muss beide Einzelwege auslösen — sonst prüfen die
    // Zusicherungen oben nichts.
    gesehen.length = 0;
    zaehlen = true;
    await fc.resolveBlPartNumber('bwt-teil-gibtesnicht');
    zaehlen = false;
    assert.equal(wieOft(/FROM rb_bl_mapping WHERE part_num=\$1/), 1,
      'Gegenprobe: die Einzelabfrage auf rb_bl_mapping wurde nicht mitgezählt');
    assert.equal(wieOft(/FROM parts WHERE part_number=\$1 AND bl_part_number/), 1,
      'Gegenprobe: die Einzelabfrage auf parts wurde nicht mitgezählt');
  } finally {
    db.pool.query = altQuery;
    await aufraeumen();
    await db.pool.end().catch(() => {});
  }
});
