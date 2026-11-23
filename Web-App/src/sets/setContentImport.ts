import { errorMessage } from '../infra/error';
import type { SetsContext } from './context';

/** Catalog and inventory in one transaction; throws on errors, the job then retries. */
export async function importMinifigs(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const { minifigs, fromSource } = await k.catalog.loadSetMinifigs(setNumber);
  if (!minifigs.length) return 0;
  const numbers = minifigs.map(f => f.fig_number);
  await k.transact(async t => {
    await t.inventory.setContent.enterMinifigs(userId, setNumber, numbers);
    await t.catalog.rememberSetFigs(setNumber, minifigs, fromSource);
  });
  console.log(`[minifigs] ${setNumber}: ${minifigs.length} importiert`);
  return minifigs.length;
}

/** In one transaction, so that an error never leaves a set without parts. */
export async function importParts(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const loaded = await k.catalog.loadSetParts(setNumber);
  if (!loaded) return 0;
  const { n, rows } = loaded;
  const parts = rows.map(z => z.partNumber),
    colors = rows.map(z => z.colorId);
  for (let attempt = 1; ; attempt++) {
    try {
      await k.transact(async t => {
        await t.inventory.setContent.enterParts(userId, n, parts, colors);
        await t.catalog.rememberSetParts(n, rows);
      });
      break;
    } catch (e) {
      // The fixed order makes deadlocks rare, but does not rule them out entirely.
      if (!errorMessage(e)?.includes('deadlock') || attempt >= 3) throw e;
      console.warn(`[parts] Deadlock bei ${n}, Versuch ${attempt}/3`);
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
  await k.catalog.enqueueSetPartImages(n, rows);
  console.log(`[parts] ${n}: ${rows.length} importiert`);
  return rows.length;
}
