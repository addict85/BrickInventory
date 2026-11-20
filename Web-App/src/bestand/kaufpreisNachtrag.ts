import { setEstimatedPrice } from './acquisitions';
import { versuche } from '../infra/ergebnis';
import { setTimeout as warte } from 'node:timers/promises';
import type { InventoryContext } from './kontext';

function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}

/** Erfassungen ohne Kaufpreis (BrickLink am Tageslimit) bekommen den Marktpreis. Jede Zeile wird
 * versucht; gescheiterte lassen den Schritt am Ende scheitern, damit run() ihn meldet. */
async function jeRow<Z>(art: string, rows: Z[], f: (z: Z) => Promise<boolean>): Promise<void> {
  if (!rows.length) return;
  log(`${art} ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  const fehler: unknown[] = [];
  for (const row of rows) {
    try {
      if (await f(row)) done++;
    } catch (e) {
      fehler.push(e);
    }
    await warte(1500); // Tageskontingent von BrickLink schonen
  }
  log(`${art} nachgetragen: ${done} von ${rows.length}`);
  if (fehler.length) throw new AggregateError(fehler, `${art}: ${fehler.length} von ${rows.length} gescheitert`);
}

async function backfillAcquisitions(k: InventoryContext) {
  await jeRow('Erfassungen', await k.nachtrag.setEntriesWithoutPrice(), async row => {
    const price = await k.finanzen.aktuellerMarktpreis(row.set_number, row.user_id, row.condition || null);
    return !!price && (await setEstimatedPrice(k, 'set', row.id, price));
  });
}

// Dieselbe Lücke wie bei den Sets, für Teile- und Figuren-Erfassungen.
async function backfillPartsEntries(k: InventoryContext) {
  await jeRow('Teile-Erfassungen', await k.nachtrag.partEntriesWithoutPrice(), async row => {
    const price = await k.finanzen.currentPartMarketPrice(
      row.part_number,
      row.color_id,
      row.user_id,
      row.condition || null,
    );
    return !!price && (await setEstimatedPrice(k, 'part', row.id, price));
  });
}

async function backfillMinifigsEntries(k: InventoryContext) {
  await jeRow('Figuren-Erfassungen', await k.nachtrag.minifigEntriesWithoutPrice(), async row => {
    // Die eigene BrickLink-Nummer des Kontos vor der gemeinsamen.
    const price = await k.finanzen.currentMinifigMarketPrice(
      row.fig_number,
      row.user_id,
      await k.katalog.blFetchNumber('fig', row.fig_number, row.user_id),
      row.condition || null,
    );
    return !!price && (await setEstimatedPrice(k, 'fig', row.id, price));
  });
}

/** Jeder Schritt läuft; danach wirft der Lauf, damit der Auftrag ihn wiederholt und zeigt. */
async function run(k: InventoryContext) {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  const schritte: [string, () => Promise<unknown>][] = [
    ['set-erfassungen', () => backfillAcquisitions(k)],
    ['figuren-erfassungen', () => backfillMinifigsEntries(k)],
    ['teile-erfassungen', () => backfillPartsEntries(k)],
    ['teilfarbenbilder', () => k.katalog.backfillPartColorsImages()],
  ];
  const ohne: string[] = [];
  for (const [name, schritt] of schritte)
    if (!(await versuche(`kaufpreis-nachtrag:${name}`, schritt)).ok) ohne.push(name);
  if (ohne.length) throw new Error(`Kaufpreis-Nachtrag gescheitert: ${ohne.join(', ')}`);
  log('Migration abgeschlossen.');
}

export { run };
