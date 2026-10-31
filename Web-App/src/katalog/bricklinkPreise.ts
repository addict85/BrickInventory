/**
 * Der BrickLink-Preisführer zu einer Set-Nummer. Der Client fragt nur ab; hier
 * fällt die Entscheidung, unter welcher Art (Set, Gear, Buch) gefragt wird, und
 * der Katalog merkt sich die Antwort, damit der nächste Abruf gleich richtig fragt.
 */
import { bricklinkRequest } from '../../clients/bricklink';
import { alsAbrufFehler } from '../../clients/abrufFehler';
import { hatPreis } from '../finanzen/preisRegel';
import { mitVersion, ohneBricklinkPreis, ohneVersion } from '../sets/setNummer';
import * as repo from './repository/katalogCache';
import type { KatalogEintrag } from './repository/katalogCache';

export type { KatalogEintrag };

/** Der Katalog-Eintrag zu einem Set — unter der Schreibweise, unter der er abgelegt wird. */
export function katalogEintrag(setNumber: string): Promise<KatalogEintrag | null> {
  return repo.katalogEintragZu(mitVersion(setNumber));
}

/** Nicht gefunden oder ungültig: dann wird die nächste Art versucht. */
const weiterVersuchen = (e: unknown) => { const c = alsAbrufFehler(e).detail?.meta?.code; return c === 404 || c === 400; };

// Vorgabe 'N': Ein Aufruf ohne expliziten Zustand hat vorher den
// GEBRAUCHT-Preis geholt und im Cache abgelegt.
async function getPriceGuideRaw(setNumber: string, condition = 'N', guideType = 'sold', currencyCode = 'EUR') {
  const n = mitVersion(setNumber);
  const bare = ohneVersion(n);
  const params = { guide_type: guideType, new_or_used: condition, currency_code: currencyCode, vat: 'N' };
  const cached = await katalogEintrag(n);
  if (cached?.bl_type === 'GEAR') return await bricklinkRequest('GET', `/items/gear/${bare}/price`, params);
  if (cached?.bl_type === 'BOOK') return await bricklinkRequest('GET', `/items/book/${bare}/price`, params);
  if (ohneBricklinkPreis(cached)) throw new Error(`${n} — kein BrickLink-Preis verfügbar`);
  try {
    return await bricklinkRequest('GET', `/items/set/${n}/price`, params);
  } catch (e) {
    if (!weiterVersuchen(e)) throw e;
  }
  for (const art of ['GEAR', 'BOOK'] as const) {
    try {
      const result = await bricklinkRequest('GET', `/items/${art.toLowerCase()}/${bare}/price`, params);
      await repo.merkeBricklinkArt(n, art);
      return result;
    } catch (e) {
      if (!weiterVersuchen(e)) throw e;
    }
  }
  await repo.merkeBricklinkArt(n, 'NONE');
  throw new Error(`${n} nicht auf BrickLink gefunden (Set/Gear/Book) — kein Preis`);
}

/**
 * Preisabfrage mit Rückfall von 'sold' auf 'stock'.
 * Ausführlich: docs/begruendungen/clients/bricklink.ts.md#getpriceguide
 */
export async function getPriceGuide(setNumber: string, condition = 'N', guideType = 'sold', currencyCode = 'EUR') {
  const first = await getPriceGuideRaw(setNumber, condition, guideType, currencyCode);
  if (hatPreis(first) || guideType !== 'sold') {
    return { ...first, guide_used: guideType };
  }
  // Kein Verkauf in sechs Monaten → aktuelle Angebote heranziehen.
  try {
    const alt = await getPriceGuideRaw(setNumber, condition, 'stock', currencyCode);
    if (hatPreis(alt)) return { ...alt, guide_used: 'stock', guide_fallback: true };
  } catch (_) { /* Rückfall ist optional — dann bleibt es beim leeren Ergebnis */ }
  return { ...first, guide_used: guideType };
}

/**
 * Zwischenspeicher leeren — ohne Setnummer den ganzen.
 * Ausführlich: docs/begruendungen/clients/bricklink.ts.md#clearsubsetscache
 */
export async function clearSubsetsCache(sn: string | null = null) {
  await repo.leereSubsetsCache(sn ? mitVersion(sn) : null);
}

/** Siehe clearSubsetsCache(): ohne Setnummer der ganze Zwischenspeicher. */
export async function clearCatalogCache(sn: string | null = null) {
  await repo.leereKatalogCache(sn ? mitVersion(sn) : null);
}

export const getCacheStats = repo.cacheZahlen;
