import { getCurrentMarketPrice, getCurrentFigMarketPrice, getCurrentPartMarketPrice } from '../finanzen/marketPrice';
import { setzeGeschaetztenPreis } from './acquisitions';
import { teilfarbenbilderNachtragen } from '../katalog/katalogAbgleich';
import { blAbrufNummer } from '../katalog/blZuordnung';
import { fehlertext, meldeFehler } from '../infra/fehler';
import { setTimeout as warte } from 'node:timers/promises';
import { bestandBereich } from './prozess';

// Idempotent: Erfassungen ohne Kaufpreis bekommen den Marktpreis, wie beim
// Erfassen ohne Kaufpreis.


function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}


// Scheitert BrickLink beim CSV-Import am Tageslimit, bleibt die Erfassung ohne Preis; hier wird nachgetragen.
async function backfillAcquisitions() {
  const rows = await bestandBereich().nachtrag.setErfassungenOhnePreis();
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
    await warte(1500); // Tageskontingent von BrickLink schonen
  }
  log(`Erfassungen nachgetragen: ${done} von ${rows.length}`);
}

// Dieselbe Lücke wie bei den Sets, für Teile- und Figuren-Erfassungen.
async function backfillTeileErfassungen() {
  const rows = await bestandBereich().nachtrag.teilErfassungenOhnePreis();
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
    } catch (e) { meldeFehler('kaufpreis-nachtrag:teil-erfassung', e); }
    await warte(1500);
  }
  log(`Teile-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

async function backfillFigurenErfassungen() {
  const rows = await bestandBereich().nachtrag.figurErfassungenOhnePreis();
  if (!rows.length) return;
  log(`Figuren-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      // Die eigene BrickLink-Nummer des Kontos vor der gemeinsamen.
      const price = await getCurrentFigMarketPrice(
        row.fig_number, row.user_id,
        await blAbrufNummer('fig', row.fig_number, row.user_id), row.condition || null);
      if (price) {
        if (await setzeGeschaetztenPreis('fig', row.id, price)) done++;
      }
    } catch (e) { meldeFehler('kaufpreis-nachtrag:figur-erfassung', e); }
    await warte(1500);
  }
  log(`Figuren-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

async function run() {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  await backfillAcquisitions().catch(e => log(`Erfassungen Fehler: ${e.message}`));
  await backfillFigurenErfassungen().catch(e => log(`Figuren-Erfassungen Fehler: ${e.message}`));
  await backfillTeileErfassungen().catch(e => log(`Teile-Erfassungen Fehler: ${e.message}`));
  await teilfarbenbilderNachtragen().catch(e => log(`Teile-Bilder Fehler: ${e.message}`));
  log('Migration abgeschlossen.');
}

export { run };