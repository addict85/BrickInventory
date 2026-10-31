/**
 * UPCitemdb: Produkttitel zu einer EAN (frei, 100 Abfragen am Tag). Der
 * Titel ist Händlertext; welche Zahl darin die Setnummer ist, entscheidet
 * utils/produkttitel.ts.
 */
import { httpsGetRobust } from './rebrickable';
import { meldeUndLiefere } from '../src/infra/httpError';

export async function produktTitel(ean13: string): Promise<string | null> {
  const antwort = await httpsGetRobust(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(ean13)}`,
    { 'User-Agent': 'BrickInventoryManager/1.0' }, 6000).catch(meldeUndLiefere('upcitemdb:abruf', null));
  if (!antwort || antwort.status !== 200) return null;
  try { return JSON.parse(antwort.body)?.items?.[0]?.title || null; }
  catch (e) { return meldeUndLiefere('upcitemdb:antwort', null)(e); }
}
