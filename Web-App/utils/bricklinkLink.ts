/**
 * BrickLink-Katalog-Links für Set-Nummern.
 * Ausführlich: docs/begruendungen/utils/bricklinkLink.ts.md#abschnitt
 */
import { logAndContinue, meldeUndLiefere } from '../src/infra/httpError';
import * as db from '../db/database';
import { bricklinkRequest } from '../clients/bricklink';
import { getGlobalSetting } from '../src/konto/settings';
import { mitVersion, ohneVersion } from '../src/sets/setNummer';

export type BlType = 'SET' | 'GEAR' | 'BOOK' | 'MINIFIG' | 'NONE';

export interface BlLink {
  /** Item-Typ im BrickLink-Katalog */
  type: BlType;
  /** Artikelnummer in BrickLink-Schreibweise (Gear/Book ohne -N-Suffix) */
  number: string;
  /**
   * Ziel-URL. IMMER gesetzt: Ist der Artikel nicht eindeutig bestimmbar,
   * zeigt sie auf die BrickLink-Suche statt auf eine Katalogseite.
   * Ein Button, der verschwindet, ist schlechter als einer, der zur Suche führt.
   */
  url: string;
  /** true = direkte Katalogseite, false = Suchtreffer-Liste */
  exact: boolean;
  /** false, wenn der Typ noch nie gegen BrickLink aufgelöst wurde (Annahme: SET) */
  resolved: boolean;
}

/** Rebrickable-Schreibweise: immer mit Variantensuffix. */
// Die Schreibweise kommt aus src/sets/setNummer.ts
// Die beiden Fassungen stimmen auf jeder echten Nummer ueberein und gehen erst
// bei einem Bindestrich OHNE Ziffernanhang auseinander:
// Ausführlich: docs/begruendungen/utils/bricklinkLink.ts.md#withvariant
export function withVariant(setNumber: string): string {
  return mitVersion(String(setNumber || '').trim());
}

/** BrickLink-Schreibweise für Gear/Book: ohne Variantensuffix. */
export function bareNumber(setNumber: string): string {
  return ohneVersion(String(setNumber || '').trim());
}

/** Query-Parameter und Tab-Kürzel je Item-Typ. */
const PARAM: Record<Exclude<BlType, 'NONE'>, string> = { SET: 'S', GEAR: 'G', BOOK: 'B', MINIFIG: 'M' };

export function buildUrl(type: BlType, number: string): string | null {
  if (type === 'NONE') return null;
  const p = PARAM[type];
  // #T=<p> öffnet direkt den "For Sale"-Tab, O={"iconly":0} die Listenansicht.
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?${p}=${encodeURIComponent(number)}` +
         `#T=${p}&O={%22iconly%22:0}`;
}

/**
 * Rückfallebene, wenn der Artikel nicht eindeutig bestimmbar ist.
 * Ausführlich: docs/begruendungen/utils/bricklinkLink.ts.md#searchurl
 */
export function searchUrl(number: string): string {
  return `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(bareNumber(number))}`;
}

const KNOWN: BlType[] = ['SET', 'GEAR', 'BOOK', 'MINIFIG', 'NONE'];

function toLink(setNumber: string, blType: string | null | undefined): BlLink {
  const type = KNOWN.includes(blType as BlType) ? (blType as BlType) : null;
  // Ohne Cache-Eintrag ist SET die richtige Annahme: die grosse Mehrheit der
  // Rebrickable-Sets ist auf BrickLink auch ein Set mit identischer Nummer.
  const effective: BlType = type ?? 'SET';
  const number = effective === 'SET' ? withVariant(setNumber) : bareNumber(setNumber);
  const exactUrl = buildUrl(effective, number);
  // bl_type = 'NONE' heisst nur "nicht als Set, Gear oder Buch gefunden" — die
  // Sondierungskette in clients/bricklink.ts kennt MINIFIG gar nicht. Genau das
  // trifft Sammelminifiguren, und dafür darf der Button nicht verschwinden.
  return exactUrl
    ? { type: effective, number, url: exactUrl, exact: true, resolved: type !== null }
    : { type: effective, number, url: searchUrl(setNumber), exact: false, resolved: type !== null };
}

/**
 * Gebündelte Auflösung: eine SQL-Abfrage für beliebig viele Set-Nummern.
 * Für Listen- und Katalogseiten gedacht — ersetzt N Einzelabfragen durch eine.
 *
 * @param setNumbers Set-Nummern in beliebiger Schreibweise (mit oder ohne -N)
 * @returns Map, geschlüsselt auf die Rebrickable-Schreibweise (mit -N)
 */
export async function resolveMany(setNumbers: string[]): Promise<Map<string, BlLink>> {
  const out = new Map<string, BlLink>();
  const keys = [...new Set((setNumbers || []).filter(Boolean).map(withVariant))];
  if (keys.length === 0) return out;

  const rows = await db.all(
    'SELECT set_number, bl_type FROM catalog_cache WHERE set_number = ANY($1::text[])',
    [keys]
  ).catch(meldeUndLiefere('bl-link:rows', []));

  const byNumber = new Map<string, string | null>();
  for (const r of rows) byNumber.set(r.set_number, r.bl_type);
  for (const k of keys) out.set(k, toLink(k, byNumber.get(k)));
  return out;
}

/** Einzelauflösung — dünner Wrapper über resolveMany, damit es nur eine Logik gibt. */
export async function resolveOne(setNumber: string): Promise<BlLink> {
  const m = await resolveMany([setNumber]);
  return m.get(withVariant(setNumber)) as BlLink;
}

/**
 * Auflösung eines noch unbekannten Typs gegen die BrickLink-API und Ablage in
 * catalog_cache. Bewusst dieselbe Fallback-Kette wie beim Preisabruf in
 * clients/bricklink.ts (set → gear → book → NONE), nur über /items statt
 * /items/.../price — das ist die günstigere Abfrage, wenn nur der Typ zählt.
 * Ausführlich: docs/begruendungen/utils/bricklinkLink.ts.md#resolveviaapi
 */
export async function resolveViaApi(setNumber: string): Promise<BlLink> {
  const n = withVariant(setNumber);
  const bare = bareNumber(setNumber);

  // Kein Zugang konfiguriert → bei der Annahme bleiben, nichts cachen.
  // Die frühere COUNT-Abfrage prüfte zusätzlich auf value <> ''; getGlobalSetting()
  // liefert den Wert selbst, und die leere Zeichenkette ist hier gleichbedeutend
  // mit „nicht konfiguriert".
  if (!await getGlobalSetting('bricklink_consumer_key')) return toLink(n, null);

  const notFound = (e: any) => e?.detail?.meta?.code === 404 || e?.detail?.meta?.code === 400;

  const probe = async (type: Exclude<BlType, 'NONE'>, no: string) => {
    try { await bricklinkRequest('GET', `/items/${type.toLowerCase()}/${no}`); return true; }
    catch (e) { if (notFound(e)) return false; throw e; }
  };

  let found: BlType = 'NONE';
  try {
    if      (await probe('SET',     n))    found = 'SET';
    else if (await probe('GEAR',    bare)) found = 'GEAR';
    else if (await probe('BOOK',    bare)) found = 'BOOK';
    // MINIFIG zusätzlich: trifft nur, wenn BrickLink zufällig dieselbe Nummer
    // führt. Bei Sammelminifiguren (71021-1 → col325) ist das nicht so — dann
    // bleibt es bei NONE und der Suchlink greift.
    else if (await probe('MINIFIG', bare)) found = 'MINIFIG';
  } catch (_) {
    // Netz- oder Rate-Limit-Fehler: nicht cachen, damit es später erneut geht.
    return toLink(n, null);
  }

  await db.run(
    `INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,$4)
     ON CONFLICT (set_number) DO UPDATE SET bl_type = $3, fetched_at = NOW()`,
    [n, `Set ${n}`, found, found === 'NONE' ? 1 : 0]
  ).catch(logAndContinue('bl-link:probe'));
  return toLink(n, found);
}
