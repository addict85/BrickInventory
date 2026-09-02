import { getCurrentMarketPrice } from '../utils/marketPrice';
import { getCurrentFigMarketPrice } from '../routes/minifigs';
import { getCurrentPartMarketPrice, lookupPart } from '../routes/parts';
import { fehlertext, logAndContinue, meldeUndWeiter } from '../utils/httpError';
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

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Erfassungen ohne Kaufpreis nachtragen — unabhängig von der Set-Zeile.
 *
 * Die Lücke: backfillSets() betrachtet nur Sets mit `purchase_price IS NULL`
 * und zieht deren Erfassungen mit. Bekam die Set-Zeile beim Import einen Preis,
 * die Erfassung aber nicht, blieb sie dauerhaft leer.
 *
 * Genau das passiert beim CSV-Import: Er fragt zuerst den Preis-Cache ab und
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
        await db.run('UPDATE set_acquisitions SET purchase_price=$1 WHERE id=$2', [price, row.id]);
        // sets.purchase_price spiegelt die LETZTE Erfassung — nur setzen, wenn
        // dort noch nichts steht, sonst überschriebe der Nachtrag einen
        // bewusst gepflegten Wert.
        await db.run(`UPDATE sets SET purchase_price=$1
                       WHERE user_id=$2 AND set_number=$3 AND purchase_price IS NULL`,
          [price, row.user_id, row.set_number]).catch((e: any) => log(`Spiegelung ${row.set_number} fehlgeschlagen: ${e.message}`));
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

async function backfillSets() {
  const rows = await db.all(
    'SELECT id, user_id, set_number FROM sets WHERE purchase_price IS NULL ORDER BY id ASC'
  ).catch(() => []);
  if (!rows.length) return;
  log(`Sets ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentMarketPrice(row.set_number, row.user_id);
      if (price) {
        await db.run('UPDATE sets SET purchase_price=$1 WHERE id=$2', [price, row.id]);
        // Erfassungen ohne Preis mit dem ermittelten Marktpreis nachziehen
        await db.run(`UPDATE set_acquisitions SET purchase_price=$1
                      WHERE user_id=$2 AND set_number=$3 AND purchase_price IS NULL`,
          [price, row.user_id, row.set_number]).catch((e: any) => log(`Nachtrag ${row.set_number} fehlgeschlagen: ${e.message}`));
        done++;
      }
    } catch (e) {
      log(`übersprungen (${row.set_number}): ${fehlertext(e)}`);
    }
    await sleep(1500); // pace requests to respect BrickLink daily limit
  }
  log(`Sets migriert: ${done}/${rows.length}`);
}

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
        await db.run('UPDATE parts SET image_url=$1 WHERE id=$2', [info.image_url, row.id]);
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
  await backfillSets().catch(e => log(`Sets Fehler: ${e.message}`));
  // Nach backfillSets: Dort werden Erfassungen bereits mitgezogen, wenn die
  // Set-Zeile leer war. Der Durchlauf hier fängt die übrigen ab.
  await backfillAcquisitions().catch(e => log(`Erfassungen Fehler: ${e.message}`));
  await backfillMinifigs().catch(e => log(`Minifiguren Fehler: ${e.message}`));
  await backfillParts().catch(e => log(`Teile Fehler: ${e.message}`));
  await backfillPartImages().catch(e => log(`Teile-Bilder Fehler: ${e.message}`));
  log('Migration abgeschlossen.');
}

export { run };