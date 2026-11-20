import { fehlertext } from '../infra/error';
import type { SetsContext } from './context';

/** Catalog and inventory in one transaction; throws on errors, the job then retries. */
export async function importMinifigs(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const { figuren, fromSource } = await k.catalog.loadSetMinifigs(setNumber);
  if (!figuren.length) return 0;
  const nummern = figuren.map(f => f.fig_number);
  await k.transaktion(async t => {
    await t.inventory.setInhalt.enterMinifigs(userId, setNumber, nummern);
    await t.catalog.setFigurenMerken(setNumber, figuren, fromSource);
  });
  console.log(`[minifigs] ${setNumber}: ${figuren.length} importiert`);
  return figuren.length;
}

/** In one transaction, so that an error never leaves a set without parts. */
export async function importParts(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const geladen = await k.catalog.loadSetParts(setNumber);
  if (!geladen) return 0;
  const { n, zeilen } = geladen;
  const teile = zeilen.map(z => z.partNumber),
    farben = zeilen.map(z => z.colorId);
  for (let versuch = 1; ; versuch++) {
    try {
      await k.transaktion(async t => {
        await t.inventory.setInhalt.enterParts(userId, n, teile, farben);
        await t.catalog.setTeileMerken(n, zeilen);
      });
      break;
    } catch (e) {
      // The fixed order makes deadlocks rare, but does not rule them out entirely.
      if (!fehlertext(e)?.includes('deadlock') || versuch >= 3) throw e;
      console.warn(`[parts] Deadlock bei ${n}, Versuch ${versuch}/3`);
      await new Promise(r => setTimeout(r, 200 * versuch));
    }
  }
  await k.catalog.enqueueSetPartImages(n, zeilen);
  console.log(`[parts] ${n}: ${zeilen.length} importiert`);
  return zeilen.length;
}
