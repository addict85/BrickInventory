import { setEstimatedPrice } from './acquisitions';
import { attempts } from '../infra/result';
import { setTimeout as sleep } from 'node:timers/promises';
import type { InventoryContext } from './context';

function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}

/** Acquisitions without a purchase price (BrickLink at the daily limit) get the market price. Every row is
 * attempted; failed ones make the step fail at the end so that run() reports it. */
async function jeRow<Z>(kind: string, rows: Z[], f: (z: Z) => Promise<boolean>): Promise<void> {
  if (!rows.length) return;
  log(`${kind} ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  const error: unknown[] = [];
  for (const row of rows) {
    try {
      if (await f(row)) done++;
    } catch (e) {
      error.push(e);
    }
    await sleep(1500); // spare BrickLink's daily quota
  }
  log(`${kind} nachgetragen: ${done} von ${rows.length}`);
  if (error.length) throw new AggregateError(error, `${kind}: ${error.length} von ${rows.length} gescheitert`);
}

async function backfillAcquisitions(k: InventoryContext) {
  await jeRow('Erfassungen', await k.backfill.setEntriesWithoutPrice(), async row => {
    const price = await k.finances.currentMarketPrice(row.set_number, row.user_id, row.condition || null);
    return !!price && (await setEstimatedPrice(k, 'set', row.id, price));
  });
}

// The same gap as for the sets, for part and figure acquisitions.
async function backfillPartsEntries(k: InventoryContext) {
  await jeRow('Teile-Erfassungen', await k.backfill.partEntriesWithoutPrice(), async row => {
    const price = await k.finances.currentPartMarketPrice(
      row.part_number,
      row.color_id,
      row.user_id,
      row.condition || null,
    );
    return !!price && (await setEstimatedPrice(k, 'part', row.id, price));
  });
}

async function backfillMinifigsEntries(k: InventoryContext) {
  await jeRow('Figuren-Erfassungen', await k.backfill.minifigEntriesWithoutPrice(), async row => {
    // The account's own BrickLink number before the shared one.
    const price = await k.finances.currentMinifigMarketPrice(
      row.fig_number,
      row.user_id,
      await k.catalog.blFetchNumber('fig', row.fig_number, row.user_id),
      row.condition || null,
    );
    return !!price && (await setEstimatedPrice(k, 'fig', row.id, price));
  });
}

/** Every step runs; afterwards the run throws so that the job repeats and shows it. */
async function run(k: InventoryContext) {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  const steps: [string, () => Promise<unknown>][] = [
    ['set-erfassungen', () => backfillAcquisitions(k)],
    ['figuren-erfassungen', () => backfillMinifigsEntries(k)],
    ['teile-erfassungen', () => backfillPartsEntries(k)],
    ['teilfarbenbilder', () => k.catalog.backfillPartColorsImages()],
  ];
  const without: string[] = [];
  for (const [name, step] of steps) if (!(await attempts(`kaufpreis-nachtrag:${name}`, step)).ok) without.push(name);
  if (without.length) throw new Error(`Kaufpreis-Nachtrag gescheitert: ${without.join(', ')}`);
  log('Migration abgeschlossen.');
}

export { run };
