/**
 * UPCitemdb: Produkttitel zu einer EAN (frei, 100 Abfragen am Tag). Der
 * Titel ist Händlertext; welche Zahl darin die Setnummer ist, entscheidet
 * src/katalog/produkttitel.ts.
 */
import { httpsGetRobust } from './rebrickable';
import { meldeUndLiefere } from '../src/infra/fehler';

export async function produktTitel(ean13: string): Promise<string | null> {
  try {
    const antwort = await httpsGetRobust(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(ean13)}`,
      { 'User-Agent': 'BrickInventoryManager/1.0' }, 6000);
    if (antwort.status !== 200) return null;
    return JSON.parse(antwort.body)?.items?.[0]?.title || null;
  } catch (e) {
    // Ausnahme: letzte von mehreren Barcode-Quellen; ohne Antwort gilt die EAN als unbekannt.
    return meldeUndLiefere('upcitemdb:abruf', null)(e);
  }
}
