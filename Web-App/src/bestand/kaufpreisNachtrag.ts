import { setzeGeschaetztenPreis } from './acquisitions';
import { meldeFehler } from '../infra/fehler';
import { versuche } from '../infra/ergebnis';
import { setTimeout as warte } from 'node:timers/promises';
import type { BestandKontext } from './kontext';

// Idempotent: Erfassungen ohne Kaufpreis bekommen den Marktpreis, wie beim
// Erfassen ohne Kaufpreis.

function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}

// Scheitert BrickLink beim CSV-Import am Tageslimit, bleibt die Erfassung ohne Preis; hier wird nachgetragen.
async function backfillAcquisitions(k: BestandKontext) {
  const rows = await k.nachtrag.setErfassungenOhnePreis();
  if (!rows.length) return;
  log(`Erfassungen ohne Kaufpreis: ${rows.length}`);

  let done = 0;
  for (const row of rows) {
    try {
      const price = await k.finanzen.getCurrentMarketPrice(row.set_number, row.user_id, row.condition || null);
      if (price) {
        if (await setzeGeschaetztenPreis(k, 'set', row.id, price)) done++;
      }
    } catch (e) {
      // Eine Zeile bricht den Nachtrag nicht ab, wird aber gemeldet.
      meldeFehler(`kaufpreis-nachtrag:set-erfassung ${row.set_number}`, e);
    }
    await warte(1500); // Tageskontingent von BrickLink schonen
  }
  log(`Erfassungen nachgetragen: ${done} von ${rows.length}`);
}

// Dieselbe Lücke wie bei den Sets, für Teile- und Figuren-Erfassungen.
async function backfillTeileErfassungen(k: BestandKontext) {
  const rows = await k.nachtrag.teilErfassungenOhnePreis();
  if (!rows.length) return;
  log(`Teile-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      const price = await k.finanzen.getCurrentPartMarketPrice(
        row.part_number,
        row.color_id,
        row.user_id,
        row.condition || null,
      );
      if (price) {
        if (await setzeGeschaetztenPreis(k, 'part', row.id, price)) done++;
      }
    } catch (e) {
      meldeFehler('kaufpreis-nachtrag:teil-erfassung', e);
    }
    await warte(1500);
  }
  log(`Teile-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

async function backfillFigurenErfassungen(k: BestandKontext) {
  const rows = await k.nachtrag.figurErfassungenOhnePreis();
  if (!rows.length) return;
  log(`Figuren-Erfassungen ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  for (const row of rows) {
    try {
      // Die eigene BrickLink-Nummer des Kontos vor der gemeinsamen.
      const price = await k.finanzen.getCurrentFigMarketPrice(
        row.fig_number,
        row.user_id,
        await k.katalog.blAbrufNummer('fig', row.fig_number, row.user_id),
        row.condition || null,
      );
      if (price) {
        if (await setzeGeschaetztenPreis(k, 'fig', row.id, price)) done++;
      }
    } catch (e) {
      meldeFehler('kaufpreis-nachtrag:figur-erfassung', e);
    }
    await warte(1500);
  }
  log(`Figuren-Erfassungen nachgetragen: ${done}/${rows.length}`);
}

/** Jeder Schritt läuft; danach wirft der Lauf, damit der Auftrag ihn wiederholt und zeigt. */
async function run(k: BestandKontext) {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  const schritte: [string, () => Promise<unknown>][] = [
    ['set-erfassungen', () => backfillAcquisitions(k)],
    ['figuren-erfassungen', () => backfillFigurenErfassungen(k)],
    ['teile-erfassungen', () => backfillTeileErfassungen(k)],
    ['teilfarbenbilder', () => k.katalog.teilfarbenbilderNachtragen()],
  ];
  const ohne: string[] = [];
  for (const [name, schritt] of schritte)
    if (!(await versuche(`kaufpreis-nachtrag:${name}`, schritt)).ok) ohne.push(name);
  if (ohne.length) throw new Error(`Kaufpreis-Nachtrag gescheitert: ${ohne.join(', ')}`);
  log('Migration abgeschlossen.');
}

export { run };
