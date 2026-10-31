import { getCurrentMarketPrice } from '../src/finanzen/marketPrice';
import { setzeGeschaetztenPreis, setErfassungenOhnePreis, teilErfassungenOhnePreis, figurErfassungenOhnePreis } from '../src/bestand/acquisitions';
import { manuelleFarbteile, ersetzeTeilfarbenbild } from '../src/katalog/csvKatalog';
// Die Marktpreise stehen seit dem Schichtumbau in src/finanzen/marketPrice.ts, bei
// dem fuer Sets. Vorher musste dieser Job aus zwei ROUTEN importieren, um an
// zwei Zahlen zu kommen.
import { getCurrentFigMarketPrice, getCurrentPartMarketPrice } from '../src/finanzen/marketPrice';
import { lookupPart } from '../clients/rebrickable';
import { blAbrufNummer } from '../src/katalog/blZuordnung';
import { fehlertext, meldeUndWeiter, meldeUndLiefere } from '../src/infra/httpError';
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


function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}


/**
 * Erfassungen ohne Kaufpreis nachtragen.
 * Ausführlich: docs/begruendungen/jobs/purchasePriceBackfill.ts.md#backfillacquisitions
 */
async function backfillAcquisitions() {
  const rows = await setErfassungenOhnePreis().catch(meldeUndLiefere('kaufpreis-nachtrag:rows', []));
  if (!rows.length) return;
  log(`Erfassungen ohne Kaufpreis: ${rows.length}`);

  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentMarketPrice(row.set_number, row.user_id, row.condition || null);
      if (price) {
        if (await setzeGeschaetztenPreis('set', row.id, price)) done++;
      }
    } catch (e) {
      // Eine Zeile bricht den Nachtrag nicht ab, wird aber gemeldet.
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
 * genauer, weil es den Zustand JEDER Erfassung heranzieht statt den einen Wert …
 * Ausführlich: docs/begruendungen/jobs/purchasePriceBackfill.ts.md#abschnitt
 */

/**
 * Dasselbe fuer Teile- und Figuren-ERFASSUNGEN.
 * Ausführlich: docs/begruendungen/jobs/purchasePriceBackfill.ts.md#backfillteileerfassungen
 */
async function backfillTeileErfassungen() {
  const rows = await teilErfassungenOhnePreis().catch(meldeUndLiefere('kaufpreis-nachtrag:rows', []));
  if (!rows.length) return;
  log(`Teile-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const price = await getCurrentPartMarketPrice(
        row.part_number, row.color_id, row.user_id, row.condition || null);
      if (price) {
        if (await setzeGeschaetztenPreis('part', row.id, price)) done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:teil-erfassung', e); }
    await sleep(1500);
  }
  log(`Teile-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

async function backfillFigurenErfassungen() {
  const rows = await figurErfassungenOhnePreis().catch(meldeUndLiefere('kaufpreis-nachtrag:rows', []));
  if (!rows.length) return;
  log(`Figuren-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      // Die BrickLink-Nummer hängt an der Figur, nicht am Konto (src/katalog/blZuordnung.ts).
      const price = await getCurrentFigMarketPrice(
        row.fig_number, row.user_id,
        await blAbrufNummer('fig', row.fig_number), row.condition || null);
      if (price) {
        if (await setzeGeschaetztenPreis('fig', row.id, price)) done++;
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
  const rows = await manuelleFarbteile().catch(meldeUndLiefere('kaufpreis-nachtrag:rows', []));
  if (!rows.length) return;
  log(`Teile mit Farbbild zu prüfen: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const info = await lookupPart(row.part_number, row.color_id);
      if (info?.image_url) {
        // In den Katalog (gilt für alle Konten) und überschreibend: Das generische
        // Standardbild soll dem Bild der gewählten Farbe weichen.
        await ersetzeTeilfarbenbild(row.part_number, row.color_id, info.image_url);
        done++;
      }
    } catch (e) { meldeUndWeiter('kaufpreis-nachtrag:teilebild', e); }
    await sleep(1500);
  }
  log(`Teile-Bilder aktualisiert: ${done}/${rows.length}`);
}


async function run() {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  await backfillAcquisitions().catch(e => log(`Erfassungen Fehler: ${e.message}`));
  await backfillFigurenErfassungen().catch(e => log(`Figuren-Erfassungen Fehler: ${e.message}`));
  await backfillTeileErfassungen().catch(e => log(`Teile-Erfassungen Fehler: ${e.message}`));
  await backfillPartImages().catch(e => log(`Teile-Bilder Fehler: ${e.message}`));
  log('Migration abgeschlossen.');
}

export { run };