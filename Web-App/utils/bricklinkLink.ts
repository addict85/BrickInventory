/**
 * BrickLink-Katalog-Links für Set-Nummern.
 *
 * ── Das Problem ─────────────────────────────────────────────────────────────
 * Der Katalog steht auf Rebrickable-Daten (rb_sets.set_num, Format "75192-1").
 * Die Detailansicht hat daraus bisher direkt einen Link gebaut:
 *
 *     catalogitem.page?S=75192-1#T=S
 *
 * Für echte Sets stimmt das — Rebrickable und BrickLink verwenden dort
 * dieselbe Nummer. Falsch wird es bei allem, was BrickLink NICHT als Set
 * führt: Gear, Bücher und Nicht-Katalogware. Dort ist sowohl der Parameter
 * falsch (S= statt G= bzw. B=) als auch die Nummer, weil BrickLink bei diesen
 * Typen keinen "-1"-Suffix vergibt. Der Link landete auf "item not found".
 *
 * ── Woher die richtige Information kommt ────────────────────────────────────
 * Nicht von Rebrickable: deren API führt external_ids ausschliesslich bei
 * PARTS (Changelog 2017-09-14), nicht bei Sets, und die CSV-Downloads haben
 * überhaupt keine BrickLink-Spalte. Es gibt also weder einzeln noch gebündelt
 * einen Weg, Rebrickable nach der BL-ID eines Sets zu fragen.
 *
 * Die Information liegt bereits lokal: clients/bricklink.ts ermittelt beim
 * Preisabruf per Fallback-Kette (set → gear → book) den tatsächlichen Typ und
 * schreibt ihn nach catalog_cache.bl_type. Diese Tabelle ist die Quelle hier.
 *
 * ── Warum "bulked" hier Datenbank heisst, nicht API ─────────────────────────
 * Die BrickLink-Store-API hat keinen Sammelendpunkt für Katalogartikel — nur
 * GET /items/{type}/{no}, einzeln, bei ~1 Anfrage/Sekunde Drosselung. Ein
 * "gebündelter Abruf" gegen BrickLink existiert schlicht nicht.
 * Bündelbar ist dafür der Teil, der die Latenz verursacht: resolveMany() löst
 * eine ganze Katalogseite mit EINER SQL-Abfrage auf, ganz ohne API-Aufruf.
 * Nur wirklich unbekannte Nummern gehen einzeln und im Hintergrund an
 * BrickLink (siehe jobs/blTypeBackfill.js).
 */
import * as db from '../db/database';
import { bricklinkRequest } from '../clients/bricklink';

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
export function withVariant(setNumber: string): string {
  const n = String(setNumber || '').trim();
  return /-\d+$/.test(n) ? n : `${n}-1`;
}

/** BrickLink-Schreibweise für Gear/Book: ohne Variantensuffix. */
export function bareNumber(setNumber: string): string {
  return withVariant(setNumber).replace(/-\d+$/, '');
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
 *
 * Der wichtigste Fall sind Sammelminifiguren: Rebrickable führt sie als Sets
 * (71021-1), BrickLink als eigenen Item-Typ MINIFIG mit einer völlig anderen
 * Nummer (col325). Diese Zuordnung gibt es in keiner der beiden Datenquellen —
 * Rebrickable hat external_ids nur bei Parts. Ein Deep-Link ist hier also
 * grundsätzlich nicht konstruierbar, eine Suche schon.
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
  ).catch(() => []);

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
 *
 * Wird ausschliesslich für EINZELNE, tatsächlich geöffnete Detailseiten
 * aufgerufen, nie für Listen: Bei ~1 erlaubten Anfrage/Sekunde wäre ein
 * Durchlauf über den gesamten Katalog (>27'000 Sets) mehr als sieben Stunden
 * Dauerlast — und die grosse Mehrheit davon ist ohnehin ein gewöhnliches Set.
 * Das Ergebnis wird dauerhaft gecacht, jede Nummer kostet also genau einmal.
 */
export async function resolveViaApi(setNumber: string): Promise<BlLink> {
  const n = withVariant(setNumber);
  const bare = bareNumber(setNumber);

  // Kein Zugang konfiguriert → bei der Annahme bleiben, nichts cachen.
  const creds = await db.get(
    "SELECT COUNT(*)::int AS n FROM global_settings WHERE key = 'bricklink_consumer_key' AND value <> ''"
  ).catch(() => null);
  if (!creds?.n) return toLink(n, null);

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
     ON CONFLICT (set_number) DO UPDATE SET bl_type = $3`,
    [n, `Set ${n}`, found, found === 'NONE' ? 1 : 0]
  ).catch(() => {});
  return toLink(n, found);
}
