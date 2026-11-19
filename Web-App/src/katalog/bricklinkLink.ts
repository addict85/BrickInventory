// Gear und Bücher führt BrickLink anders als Rebrickable; der Link muss das wissen.
import { logAndContinue } from '../infra/fehler';
import { mitVersion, ohneVersion } from '../infra/setNummer';
import type { KatalogKontext } from './kontext';

export type BlType = 'SET' | 'GEAR' | 'BOOK' | 'MINIFIG' | 'NONE';

export interface BlLink {
  type: BlType;
  /** Gear/Book ohne -N-Suffix. */
  number: string;
  /** IMMER gesetzt: Ein Button, der verschwindet, ist schlechter als einer, der
   * zur Suche führt. */
  url: string;
  exact: boolean;
  /** false, wenn der Typ noch nie gegen BrickLink aufgelöst wurde (Annahme: SET). */
  resolved: boolean;
}

// Die Schreibweise kommt aus src/infra/setNummer.ts, nicht aus einer dritten Fassung.
export function mitVariante(setNumber: string): string {
  return mitVersion(String(setNumber || '').trim());
}

export function bareNumber(setNumber: string): string {
  return ohneVersion(String(setNumber || '').trim());
}

const PARAM: Record<Exclude<BlType, 'NONE'>, string> = { SET: 'S', GEAR: 'G', BOOK: 'B', MINIFIG: 'M' };

export function blAdresse(type: BlType, number: string): string | null {
  if (type === 'NONE') return null;
  const p = PARAM[type];
  // #T=<p> öffnet direkt den "For Sale"-Tab, O={"iconly":0} die Listenansicht.
  return (
    `https://www.bricklink.com/v2/catalog/catalogitem.page?${p}=${encodeURIComponent(number)}` +
    `#T=${p}&O={%22iconly%22:0}`
  );
}

// Ohne eindeutige Zuordnung (etwa Sammelfiguren) eine Suche statt eines falschen Links.
export function blSuchadresse(number: string): string {
  return `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(bareNumber(number))}`;
}

const KNOWN: BlType[] = ['SET', 'GEAR', 'BOOK', 'MINIFIG', 'NONE'];

function toLink(setNumber: string, blType: string | null | undefined): BlLink {
  const type = KNOWN.includes(blType as BlType) ? (blType as BlType) : null;
  // Ohne Cache-Eintrag ist SET die richtige Annahme für die grosse Mehrheit.
  const effective: BlType = type ?? 'SET';
  const number = effective === 'SET' ? mitVariante(setNumber) : bareNumber(setNumber);
  const exactUrl = blAdresse(effective, number);
  // 'NONE' heisst nur „nicht als Set, Gear oder Buch gefunden" — das trifft
  // Sammelminifiguren, und für die darf der Button nicht verschwinden.
  return exactUrl
    ? { type: effective, number, url: exactUrl, exact: true, resolved: type !== null }
    : { type: effective, number, url: blSuchadresse(setNumber), exact: false, resolved: type !== null };
}

/** Eine Abfrage statt N Einzelabfragen, für Listen- und Katalogseiten.
 * @returns Map, geschlüsselt auf die Rebrickable-Schreibweise (mit -N) */
export async function vieleAufloesen(kx: KatalogKontext, setNumbers: string[]): Promise<Map<string, BlLink>> {
  const out = new Map<string, BlLink>();
  const keys = [...new Set((setNumbers || []).filter(Boolean).map(mitVariante))];
  if (keys.length === 0) return out;

  const rows = await kx.katalogCache.blTypenDerSets(keys);

  const byNumber = new Map<string, string | null>();
  for (const r of rows) byNumber.set(r.set_number, r.bl_type);
  for (const k of keys) out.set(k, toLink(k, byNumber.get(k)));
  return out;
}

/** Dünn über vieleAufloesen, damit es nur eine Logik gibt. */
export async function einesAufloesen(k: KatalogKontext, setNumber: string): Promise<BlLink> {
  const m = await vieleAufloesen(k, [setNumber]);
  return m.get(mitVariante(setNumber)) as BlLink;
}

/** Dieselbe Kette wie beim Preisabruf (set → gear → book → NONE), aber über
 * /items — günstiger, wenn nur der Typ zählt. */
export async function ueberSchnittstelleAufloesen(k: KatalogKontext, setNumber: string): Promise<BlLink> {
  const n = mitVariante(setNumber);
  const bare = bareNumber(setNumber);

  // Ohne Zugang bei der Annahme bleiben, nichts cachen.
  if (!(await k.einstellungen.globalValue('bricklink_consumer_key'))) return toLink(n, null);

  const notFound = (e: unknown) =>
    [404, 400].includes((e as { detail?: { meta?: { code?: number } } } | null)?.detail?.meta?.code ?? 0);

  const probe = async (type: Exclude<BlType, 'NONE'>, no: string) => {
    try {
      await k.fremdquellen.quellen.bricklinkRequest('GET', `/items/${type.toLowerCase()}/${no}`);
      return true;
    } catch (e) {
      if (notFound(e)) return false;
      throw e;
    }
  };

  let found: BlType = 'NONE';
  try {
    if (await probe('SET', n)) found = 'SET';
    else if (await probe('GEAR', bare)) found = 'GEAR';
    else if (await probe('BOOK', bare)) found = 'BOOK';
    // MINIFIG trifft nur, wenn BrickLink zufällig dieselbe Nummer führt; sonst
    // bleibt es bei NONE und der Suchlink greift.
    else if (await probe('MINIFIG', bare)) found = 'MINIFIG';
  } catch (_) {
    // Netz- oder Rate-Limit-Fehler: nicht cachen, damit es später erneut geht.
    return toLink(n, null);
  }

  await k.katalogCache.merkeBlTyp(n, found, found === 'NONE').catch(logAndContinue('bl-link:probe'));
  return toLink(n, found);
}
