import { fehlertext } from '../infra/fehler';
import type { SetsKontext } from './kontext';

/** Katalog und Bestand in einer Transaktion; wirft bei Fehlern, der Auftrag wiederholt dann. */
export async function importiereFiguren(k: SetsKontext, setNumber: string, userId: number): Promise<number> {
  const { figuren, ausQuelle } = await k.katalog.setFigurenLaden(setNumber);
  if (!figuren.length) return 0;
  const nummern = figuren.map(f => f.fig_number);
  await k.transaktion(async t => {
    await t.bestand.setFigurenEintragen(userId, setNumber, nummern);
    await t.katalog.setFigurenMerken(setNumber, figuren, ausQuelle);
  });
  console.log(`[minifigs] ${setNumber}: ${figuren.length} importiert`);
  return figuren.length;
}

/** In einer Transaktion, damit ein Fehler nie ein Set ohne Teile hinterlässt. */
export async function importiereTeile(k: SetsKontext, setNumber: string, userId: number): Promise<number> {
  const geladen = await k.katalog.setTeileLaden(setNumber);
  if (!geladen) return 0;
  const { n, zeilen } = geladen;
  const teile = zeilen.map(z => z.partNumber),
    farben = zeilen.map(z => z.colorId);
  for (let versuch = 1; ; versuch++) {
    try {
      await k.transaktion(async t => {
        await t.bestand.setTeileEintragen(userId, n, teile, farben);
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
  await k.katalog.setTeilBilderEinreihen(n, zeilen);
  console.log(`[parts] ${n}: ${zeilen.length} importiert`);
  return zeilen.length;
}
