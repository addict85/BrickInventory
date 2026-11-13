/** Hier fällt die Entscheidung, unter welcher Art (Set, Gear, Buch) gefragt
 * wird; der Katalog merkt sich die Antwort, damit der nächste Abruf gleich
 * richtig fragt. */
import { bricklinkRequest, alsAbrufFehler } from './quellen';
import { mitVersion, ohneBricklinkPreis, ohneVersion } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import type { KatalogEintrag } from './repository/katalogCache';
import { katalog } from './prozess';
import type { KatalogDienste } from './bereich';

export type PreisDatensatz = { avg_price?: unknown; qty_avg_price?: unknown } | null | undefined;

/** DIE Marktpreisregel (SQL: marktpreisSql): avg_price, sonst qty_avg_price, 0 ist kein
 * Preis; ein Mengenschnitt belegt Verkäufe. String(): Auch BrickLink-Antworten tragen Text. */
export function marktpreisAus(row: PreisDatensatz): number | null {
  const avg = parseFloat(String(row?.avg_price ?? ''));
  if (avg > 0) return avg;
  const qty = parseFloat(String(row?.qty_avg_price ?? ''));
  return qty > 0 ? qty : null;
}

export function hatPreis(row: PreisDatensatz): boolean {
  return marktpreisAus(row) !== null;
}

export type { KatalogEintrag };

export function setBekanntImKatalog(setNumber: string): Promise<boolean> {
  return katalog().katalogCache.setImKatalog(mitVersion(setNumber));
}

/** Unter der Schreibweise, unter der er abgelegt wird. */
export function katalogEintrag(setNumber: string, k: KatalogDienste = katalog()): Promise<KatalogEintrag | null> {
  return k.katalogCache.katalogEintragZu(mitVersion(setNumber));
}

/** Nicht gefunden oder ungültig: dann die nächste Art. */
const weiterVersuchen = (e: unknown) => {
  const c = alsAbrufFehler(e).detail?.meta?.code;
  return c === 404 || c === 400;
};

// Vorgabe 'N': Ohne Zustand wurde sonst der Gebrauchtpreis geholt und gecacht.
async function getPriceGuideRaw(setNumber: string, condition = 'N', guideType = 'sold', currencyCode = 'EUR') {
  const n = mitVersion(setNumber);
  const bare = ohneVersion(n);
  const params = { guide_type: guideType, new_or_used: condition, currency_code: currencyCode, vat: 'N' };
  const cached = await katalogEintrag(n);
  if (cached?.bl_type === 'GEAR') return await bricklinkRequest('GET', `/items/gear/${bare}/price`, params);
  if (cached?.bl_type === 'BOOK') return await bricklinkRequest('GET', `/items/book/${bare}/price`, params);
  if (ohneBricklinkPreis(cached)) fachfehler('nicht_gefunden', 'kein_bricklink_preis');
  try {
    return await bricklinkRequest('GET', `/items/set/${n}/price`, params);
  } catch (e) {
    if (!weiterVersuchen(e)) throw e;
  }
  for (const art of ['GEAR', 'BOOK'] as const) {
    try {
      const result = await bricklinkRequest('GET', `/items/${art.toLowerCase()}/${bare}/price`, params);
      await katalog().katalogCache.merkeBricklinkArt(n, art);
      return result;
    } catch (e) {
      if (!weiterVersuchen(e)) throw e;
    }
  }
  await katalog().katalogCache.merkeBricklinkArt(n, 'NONE');
  throw new Error(`${n} nicht auf BrickLink gefunden (Set/Gear/Book) — kein Preis`);
}

// Erst Verkäufe, sonst Angebote: Selten gehandelte Artikel hätten sonst nie einen Preis.
export async function getPriceGuide(setNumber: string, condition = 'N', guideType = 'sold', currencyCode = 'EUR') {
  const first = await getPriceGuideRaw(setNumber, condition, guideType, currencyCode);
  if (hatPreis(first) || guideType !== 'sold') {
    return { ...first, guide_used: guideType };
  }
  // Kein Verkauf in sechs Monaten → aktuelle Angebote heranziehen.
  try {
    const alt = await getPriceGuideRaw(setNumber, condition, 'stock', currencyCode);
    if (hatPreis(alt)) return { ...alt, guide_used: 'stock', guide_fallback: true };
  } catch (_) {
    /* Rückfall ist optional — dann bleibt es beim leeren Ergebnis */
  }
  return { ...first, guide_used: guideType };
}

// Ohne Nummer der ganze Speicher.
export async function clearSubsetsCache(sn: string | null = null) {
  await katalog().katalogCache.leereSubsetsCache(sn ? mitVersion(sn) : null);
}

export async function clearCatalogCache(sn: string | null = null) {
  await katalog().katalogCache.leereKatalogCache(sn ? mitVersion(sn) : null);
}

export const getCacheStats = () => katalog().katalogCache.cacheZahlen();
