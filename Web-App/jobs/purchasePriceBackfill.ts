import { getCurrentMarketPrice } from '../utils/marketPrice';
// Die Marktpreise stehen seit dem Schichtumbau in utils/marketPrice.ts, bei
// dem fuer Sets. Vorher musste dieser Job aus zwei ROUTEN importieren, um an
// zwei Zahlen zu kommen.
import { getCurrentFigMarketPrice, getCurrentPartMarketPrice } from '../utils/marketPrice';
import { lookupPart } from '../clients/rebrickable';
import { fehlertext, logAndContinue, meldeUndWeiter } from '../utils/httpError';
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

async function backfillMinifigs() {
  const rows = await db.all(
    "SELECT id, user_id, fig_number FROM minifigs WHERE purchase_price IS NULL AND source='manual' ORDER BY id ASC"
  ).catch(() => []);
  if (!rows.length) return;
  log(`Minifiguren ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentFigMarketPrice(row.fig_number, row.user_id);
      if (price) {
        await db.run('UPDATE minifigs SET purchase_price=$1 WHERE id=$2', [price, row.id]);
        done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:minifigur', e); }
    await sleep(1500);
  }
  log(`Minifiguren migriert: ${done}/${rows.length}`);
}

async function backfillParts() {
  const rows = await db.all(
    "SELECT id, user_id, part_number, color_id FROM parts WHERE purchase_price IS NULL AND source='manual' ORDER BY id ASC"
  ).catch(() => []);
  if (!rows.length) return;
  log(`Teile ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentPartMarketPrice(row.part_number, row.color_id, row.user_id);
      // Auch ohne gefundenen Preis 0 schreiben: NULL liesse das Kaufpreis-Feld
      // dauerhaft leer ("Marktpreis"-Platzhalter) und den Job ewig neu versuchen.
      await db.run('UPDATE parts SET purchase_price=$1 WHERE id=$2', [price || 0, row.id]);
      done++;
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:teil', e); }
    await sleep(1500);
  }
  log(`Teile migriert: ${done}/${rows.length}`);
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
async function backfillFromUnitPrice() {
  const r1 = await db.run(
    "UPDATE parts SET purchase_price = unit_price WHERE source='manual' AND purchase_price IS NULL AND unit_price IS NOT NULL"
  // Die Logzeile unten meldet sonst "0 uebernommen" — nicht unterscheidbar
  // von "es gab nichts zu tun".
  ).catch(logAndContinue('kaufpreis-nachtrag:teile'));
  const r2 = await db.run(
    "UPDATE minifigs SET purchase_price = unit_price WHERE source='manual' AND purchase_price IS NULL AND unit_price IS NOT NULL"
  ).catch(logAndContinue('kaufpreis-nachtrag:minifiguren'));
  log(`Kaufpreis aus vorhandenem Preis/Stk übernommen: ${r1?.changes||0} Teile, ${r2?.changes||0} Minifiguren`);
}

async function run() {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  await backfillFromUnitPrice().catch(e => log(`Preis/Stk-Übernahme Fehler: ${e.message}`));
  await backfillAcquisitions().catch(e => log(`Erfassungen Fehler: ${e.message}`));
  await backfillMinifigs().catch(e => log(`Minifiguren Fehler: ${e.message}`));
  await backfillParts().catch(e => log(`Teile Fehler: ${e.message}`));
  await backfillPartImages().catch(e => log(`Teile-Bilder Fehler: ${e.message}`));
  log('Migration abgeschlossen.');
}

export { run };