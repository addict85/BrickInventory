import { errorMessage } from '../infra/error';
import type { SetsContext } from './context';

/** Catalog and inventory in one transaction; throws on errors, the job then retries. */
export async function importMinifigs(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const { figuren, fromSource } = await k.catalog.loadSetMinifigs(setNumber);
  if (!figuren.length) return 0;
  const numbers = figuren.map(f => f.fig_number);
  await k.transact(async t => {
    await t.inventory.setInhalt.enterMinifigs(userId, setNumber, numbers);
    await t.catalog.setFigurenMerken(setNumber, figuren, fromSource);
  });
  console.log(`[minifigs] ${setNumber}: ${figuren.length} importiert`);
  return figuren.length;
}

/** In one transaction, so that an error never leaves a set without parts. */
export async function importParts(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const loaded = await k.catalog.loadSetParts(setNumber);
  if (!loaded) return 0;
  const { n, zeilen } = loaded;
  const parts = zeilen.map(z => z.partNumber),
    colors = zeilen.map(z => z.colorId);
  for (let attempt = 1; ; attempt++) {
    try {
      await k.transact(async t => {
        await t.inventory.setInhalt.enterParts(userId, n, parts, colors);
        await t.catalog.rememberSetParts(n, zeilen);
      });
      break;
    } catch (e) {
      // The fixed order makes deadlocks rare, but does not rule them out entirely.
      if (!errorMessage(e)?.includes('deadlock') || attempt >= 3) throw e;
      console.warn(`[parts] Deadlock bei ${n}, Versuch ${attempt}/3`);
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
  await k.catalog.enqueueSetPartImages(n, zeilen);
  console.log(`[parts] ${n}: ${zeilen.length} importiert`);
  return zeilen.length;
}
