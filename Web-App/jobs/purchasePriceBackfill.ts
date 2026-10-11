import { getCurrentMarketPrice } from '../utils/marketPrice';
// Die Marktpreise stehen seit dem Schichtumbau in utils/marketPrice.ts, bei
// dem fuer Sets. Vorher musste dieser Job aus zwei ROUTEN importieren, um an
// zwei Zahlen zu kommen.
import { getCurrentFigMarketPrice, getCurrentPartMarketPrice } from '../utils/marketPrice';
import { lookupPart } from '../clients/rebrickable';
import { blAbrufNummer } from '../utils/blZuordnung';
import { fehlertext, meldeUndWeiter } from '../utils/httpError';
import { sleep } from '../clients/rebrickable';
'use strict';

// One-time (idempotent) background migration: fills purchase_price for
// existing sets / minifigs / parts that don't have one yet, using the current
// BrickLink market price as a stand-in — mirrors the behaviour used when a
// new item is added without an explicit Kaufpreis.
//
// Runs slowly and defensively in the background so it never blocks startup
// and never floods the BrickLink API (each lookup already goes through the
// existing rate limiter / cache, this job just paces itself on top of that).

const db = require('../db/database');

function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}


/**
 * Erfassungen ohne Kaufpreis nachtragen.
 *
 * Das war früher der zweite von zwei Durchläufen: backfillSets() betrachtete
 * Sets mit `sets.purchase_price IS NULL` und zog deren Erfassungen mit, und
 * diese Funktion fing die Erfassungen ab, die dabei durchfielen — Set-Zeile
 * beim Import bepreist, Erfassung nicht. Mit Migration 0032 gibt es nur noch
 * den einen Ort und damit nur noch diesen Durchlauf.
 *
 * Die Lücke, die er schliesst, bleibt dieselbe und entsteht beim CSV-Import: Er fragt zuerst den Preis-Cache ab und
 * greift nur bei einem Treffer zu. Ist das Set dort noch nicht drin — bei neuen
 * Sets die Regel — folgt ein BrickLink-Abruf, und der scheitert bei vielen
 * Sets am Tageskontingent. Die Erfassung entsteht dann ohne Preis, und niemand
 * trägt ihn nach, sobald der Preis-Job den Cache gefüllt hat.
 *
 * Der Zustand der ERFASSUNG entscheidet über den Preis — nicht der des Sets:
 * Ein gebraucht erfasstes Exemplar bekommt den Gebrauchtpreis, auch wenn das
 * Set als neu geführt wird.
 */
async function backfillAcquisitions() {
  const rows = await db.all(
    `SELECT id, user_id, set_number, condition
       FROM set_acquisitions
      WHERE purchase_price IS NULL
      ORDER BY id ASC`
  ).catch(() => []);
  if (!rows.length) return;
  log(`Erfassungen ohne Kaufpreis: ${rows.length}`);

  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentMarketPrice(row.set_number, row.user_id, row.condition || null);
      if (price) {
        // EIN Schreibvorgang. Hier folgte eine Spiegelung nach
        // sets.purchase_price („nur setzen, wenn dort noch nichts steht, sonst
        // überschriebe der Nachtrag einen bewusst gepflegten Wert") — die
        // Spalte ist mit Migration 0032 weg, und mit ihr die Frage, welcher der
        // zwei Werte der richtige ist.
        await db.run('UPDATE set_acquisitions SET purchase_price=$1 WHERE id=$2', [price, row.id]);
        done++;
      }
    } catch (e) {
      // Eine Zeile darf den Nachtrag nicht abbrechen — aber schweigend
      // überspringen hiess: Ein Job, der bei JEDER Zeile scheitert, sieht im
      // Log identisch aus wie einer, der sauber durchläuft.
      log(`übersprungen (${row.set_number}): ${fehlertext(e)}`);
    }
    await sleep(1500); // Tageskontingent von BrickLink schonen
  }
  log(`Erfassungen nachgetragen: ${done} von ${rows.length}`);
}

/*
 * backfillSets() stand hier: ein eigener Durchlauf über `sets WHERE
 * purchase_price IS NULL`, der den Marktpreis in die Set-Zeile schrieb und die
 * Erfassungen mitzog. Beides erledigt backfillAcquisitions() oben — und zwar
 * genauer, weil es den Zustand JEDER Erfassung heranzieht statt den einen Wert
 * des Sets. Der Durchlauf hier holte den Preis ohne Zustandsangabe, also für
 * den Standardzustand; ein gebraucht erfasstes Set bekam darüber den Neupreis.
 * Mit Migration 0032 fällt sein Ziel ohnehin weg.
 */

/**
 * Dasselbe fuer Teile- und Figuren-ERFASSUNGEN.
 *
 * ── Was hier vorher stand ───────────────────────────────────────────────────
 *
 * Zwei Durchlaeufe ueber `parts`/`minifigs WHERE purchase_price IS NULL`, die
 * den Marktpreis in die Stammzeile schrieben. Migration 0035 hat die Spalte
 * geloescht; das Ziel ist weg.
 *
 * Die LUECKE bleibt aber dieselbe, und sie ist dieselbe wie bei den Sets:
 * Beim CSV-Import wird zuerst der Preis-Cache gefragt, und ist das Teil dort
 * noch nicht drin, folgt ein BrickLink-Abruf — der bei vielen Positionen am
 * Tageskontingent scheitert. Die Erfassung entsteht dann ohne Preis, und
 * niemand traegt ihn nach, sobald der Preis-Job den Cache gefuellt hat.
 *
 * Deshalb ist der Durchlauf an den EINEN verbliebenen Ort gezogen — genau wie
 * backfillAcquisitions() oben es fuer die Sets schon tat. Zwei Verbesserungen
 * fallen dabei an:
 *
 *   * Der Zustand JEDER Erfassung entscheidet ueber den Preis, nicht ein
 *     Sammelwert der Stammzeile. Ein gebraucht erfasstes Teil bekam vorher den
 *     Neupreis.
 *   * Die `0`, die der Teile-Durchlauf bei erfolglosem Abruf schrieb, entfaellt.
 *     Sie war der Anzeigewert der Stammzeile („nichts bekannt"); in einer
 *     Erfassung hiesse sie „fuer null Franken gekauft". Der Anzeigewert wird
 *     jetzt beim Lesen gebildet (COALESCE(..., 0) in handlers/parts.ts).
 */
async function backfillTeileErfassungen() {
  const rows = await db.all(
    `SELECT id, user_id, part_number, color_id, condition
       FROM part_acquisitions
      WHERE unit_price IS NULL
      ORDER BY id ASC`
  ).catch(() => []);
  if (!rows.length) return;
  log(`Teile-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentPartMarketPrice(
        row.part_number, row.color_id, row.user_id, row.condition || null);
      if (price) {
        await db.run('UPDATE part_acquisitions SET unit_price=$1 WHERE id=$2', [price, row.id]);
        done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:teil-erfassung', e); }
    await sleep(1500);
  }
  log(`Teile-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

async function backfillFigurenErfassungen() {
  const rows = await db.all(
    `SELECT id, user_id, fig_number, condition
       FROM minifig_acquisitions
      WHERE unit_price IS NULL
      ORDER BY id ASC`
  ).catch(() => []);
  if (!rows.length) return;
  log(`Figuren-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      // Die BrickLink-Nummer kommt aus der Zuordnung (Migration 0037) und
      // nicht mehr aus der Bestandszeile — sie haengt an der Figur, nicht am
      // Konto, das sie besitzt. Die Abfrage steht in utils/blZuordnung.ts,
      // weil sie auch routes/api_v1/acquisitions.ts braucht; zwei Fassungen
      // hat test/sql-kerne.test.js gemeldet.
      const price = await getCurrentFigMarketPrice(
        row.fig_number, row.user_id,
        await blAbrufNummer('fig', row.fig_number), row.condition || null);
      if (price) {
        await db.run('UPDATE minifig_acquisitions SET unit_price=$1 WHERE id=$2', [price, row.id]);
        done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:figur-erfassung', e); }
    await sleep(1500);
  }
  log(`Figuren-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

// Einmalige Korrektur: Bild soll immer die tatsächlich gewählte Farbe zeigen.
// Betrifft bestehende manuell erfasste Teile, deren Bild ursprünglich das
// generische (oft falsch-farbige) Rebrickable-Standardbild verwendet hat.
async function backfillPartImages() {
  const rows = await db.all(
    "SELECT id, part_number, color_id FROM parts WHERE source='manual' AND color_id IS NOT NULL AND color_id != 0 ORDER BY id ASC"
  ).catch(() => []);
  if (!rows.length) return;
  log(`Teile mit Farbbild zu prüfen: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const info = await lookupPart(row.part_number, row.color_id);
      if (info?.image_url) {
        // In den Katalog, nicht an die Bestandszeile: Das Bild haengt am
        // Teil-Farb-Paar und gilt fuer alle Konten (Migration 0034). Vorher
        // war es ein UPDATE je Zeile — derselbe Abruf lief also fuer jedes
        // Konto erneut, und die Bilder konnten auseinanderlaufen.
        //
        // Ueberschreibend (nicht COALESCE): Genau das ist der Zweck dieses
        // Nachtrags — ein generisches, oft falschfarbiges Standardbild soll
        // durch das Bild der tatsaechlich gewaehlten Farbe ersetzt werden.
        await db.run(`
          INSERT INTO part_color_catalog (part_number, color_id, image_url)
          VALUES ($1, $2, $3)
          ON CONFLICT (part_number, color_id) DO UPDATE
            SET image_url = EXCLUDED.image_url, updated_at = NOW()`,
          [row.part_number, row.color_id, info.image_url]);
        done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:teilebild', e); }
    await sleep(1500);
  }
  log(`Teile-Bilder aktualisiert: ${done}/${rows.length}`);
}

// Sofort-Korrektur (kein BrickLink-Call nötig): wurde beim Erfassen bereits ein
// Preis/Stk (unit_price) eingegeben, aber der Kaufpreis (purchase_price) ist aus
// irgendeinem Grund trotzdem noch leer, wird er direkt vom vorhandenen unit_price
// übernommen — genau das, was addManualPart/addManualFig eigentlich schon beim
// Erfassen tun sollten.
/*
 * backfillFromUnitPrice() stand hier: „UPDATE parts SET purchase_price =
 * unit_price WHERE purchase_price IS NULL". Es uebertrug den eingegebenen
 * Preis in den Anzeigewert — zwei Spalten derselben Zeile, von denen Migration
 * 0035 beide geloescht hat. In der Erfassung gibt es nur EINEN Preis; es gibt
 * nichts mehr zu uebertragen.
 */

async function run() {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  await backfillAcquisitions().catch(e => log(`Erfassungen Fehler: ${e.message}`));
  await backfillFigurenErfassungen().catch(e => log(`Figuren-Erfassungen Fehler: ${e.message}`));
  await backfillTeileErfassungen().catch(e => log(`Teile-Erfassungen Fehler: ${e.message}`));
  await backfillPartImages().catch(e => log(`Teile-Bilder Fehler: ${e.message}`));
  log('Migration abgeschlossen.');
}

export { run };