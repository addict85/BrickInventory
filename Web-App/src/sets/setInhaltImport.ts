import { fehlertext } from '../infra/fehler';
import type { SetsContext } from './kontext';

/** Katalog und Bestand in einer Transaktion; wirft bei Fehlern, der Auftrag wiederholt dann. */
export async function importMinifigs(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const { figuren, fromSource } = await k.katalog.loadSetMinifigs(setNumber);
  if (!figuren.length) return 0;
  const nummern = figuren.map(f => f.fig_number);
  await k.transaktion(async t => {
    await t.bestand.setInhalt.enterMinifigs(userId, setNumber, nummern);
    await t.katalog.setFigurenMerken(setNumber, figuren, fromSource);
  });
  console.log(`[minifigs] ${setNumber}: ${figuren.length} importiert`);
  return figuren.length;
}

/** In einer Transaktion, damit ein Fehler nie ein Set ohne Teile hinterlässt. */
export async function importParts(k: SetsContext, setNumber: string, userId: number): Promise<number> {
  const geladen = await k.katalog.loadSetParts(setNumber);
  if (!geladen) return 0;
  const { n, zeilen } = geladen;
  const teile = zeilen.map(z => z.partNumber),
    farben = zeilen.map(z => z.colorId);
  for (let versuch = 1; ; versuch++) {
    try {
      await k.transaktion(async t => {
        await t.bestand.setInhalt.enterParts(userId, n, teile, farben);
        await t.katalog.setTeileMerken(n, zeilen);
      });
      break;
    } catch (e) {
      // Die feste Reihenfolge macht Verklemmungen selten, ganz ausschliessen nicht.
      if (!fehlertext(e)?.includes('deadlock') || versuch >= 3) throw e;
      console.warn(`[parts] Deadlock bei ${n}, Versuch ${versuch}/3`);
      await new Promise(r => setTimeout(r, 200 * versuch));
    }
  }
  await k.katalog.enqueueSetPartImages(n, zeilen);
  console.log(`[parts] ${n}: ${zeilen.length} importiert`);
  return zeilen.length;
}
