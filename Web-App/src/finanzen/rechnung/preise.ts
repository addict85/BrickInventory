/** Die PREISSCHICHT des Finanzteils: BrickLink, Preis-Cache, Tageskontingent
 * und BL-Nummern. Eigene Datei, weil Bewertung und Gewinnrechnung auf ihr
 * stehen, nicht umgekehrt. */

import type { Preiszeile, SetPreiszeile } from '../repository/preisCache';
import { type CatalogEntry, hatPrice, marketPriceFrom } from '../../katalog';
import { asIds } from '../../haushalt';
import { logAndContinue, reportError } from '../../infra/fehler';
import { Fachfehler, fachfehler } from '../../infra/fehlerTexte';
import { withVersion, withoutBricklinkPrice } from '../../infra/setNummer';
import { effectiveCondition } from './zustand';
import { KEINE_FARBE } from '../../infra/validate';
import { versuche } from '../../infra/ergebnis';
import type { FinancesContext } from '../kontext';
import type { Uhr } from '../../infra/uhr';

/** Wessen DATEN gerechnet werden; wessen EINSTELLUNGEN gelten, sagt `viewerId`. */
export type { Blickfeld } from '../../haushalt';

type PriceRow = { avg_price?: unknown; fetched_at?: string | Date | null } | null | undefined;

/** `string | number`, weil die Einstellung als Text aus der Datenbank kommt;
 * das `parseInt(String(…))` der Rechner ist deshalb tragend. */
type Stunden = string | number;

/** DIE Zustandsauflösung für ein Set — eine, weil mehrere eigene Fassungen
 * auseinandergelaufen waren. */
export async function setState(k: FinancesContext, uid: number | number[], setNumber: string): Promise<'N' | 'U'> {
  // Blickfeld statt nackter ID: Das Set gehört oft einem Unterkonto.
  const row = await k.preisCache.setStateCounter(asIds(uid), setNumber);
  return effectiveCondition(row);
}

// 'U', weil der Gebrauchtpreis dem Wiederverkaufswert der Sammlung entspricht;
// der andere Zustand dient als Rückfall.
export const DEFAULT_PRICE_CONDITION = 'U';

/** Kürzer als das TTL-Fenster, damit ein Rückfall (sold → stock) überhaupt
 * wieder angefragt wird. */
const ZERO_PRICE_TTL_HOURS = 6;

/** Die eine Stelle, die „frisch" festlegt. */
export function emptyPriceCache(k: FinancesContext): Promise<void> {
  return k.preisCache.deleteAllSetPrices();
}

export async function priceFromCache(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  currency: string,
  ttlStunden: number,
) {
  return k.preisCache.setPriceFresh(setNumber, condition, currency, ttlStunden);
}

export function cacheUsable(row: PriceRow, ttlHours: number, jetzt: number) {
  if (!row) return false;
  // avg_price ist numeric, und pg liefert numeric als Zeichenkette.
  if (hatPrice(row)) return true;
  // 0-Eintrag: nur kurz vertrauen, danach neu versuchen.
  if (!row.fetched_at) return false;
  const ageH = (jetzt - new Date(row.fetched_at).getTime()) / 3600000;
  return ageH < Math.min(ZERO_PRICE_TTL_HOURS, ttlHours);
}

interface PriceFuehrer {
  min_price?: unknown;
  avg_price?: unknown;
  max_price?: unknown;
  qty_avg_price?: unknown;
  total_quantity?: unknown;
}

/** Erst Cache, dann (nur mit Preis) Verlaufspunkt. @returns die gelesenen Zahlen */
export async function savePrice(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  currency: string,
  g: PriceFuehrer | null | undefined,
) {
  const min = parseFloat(String(g?.min_price ?? 0)) || 0;
  const avg = parseFloat(String(g?.avg_price ?? 0)) || 0;
  const max = parseFloat(String(g?.max_price ?? 0)) || 0;
  const qavg = parseFloat(String(g?.qty_avg_price ?? 0)) || 0;
  const qty = parseInt(String(g?.total_quantity ?? 0), 10) || 0;

  // Auch eine Null wird geschrieben: Sie ist die Auskunft „kein Preis" und hält
  // den nächsten Abruf zurück; wie lange, entscheidet cacheUsable().
  const preis = { min, avg, max, qavg, qty };
  // Cache und Verlauf zusammen: Ein Cache ohne seinen Verlaufspunkt hielte den nächsten
  // Abruf zurück, und die Lücke im Verlauf füllte niemand mehr.
  await k.transaktion(async t => {
    await t.preisCache.rememberSetPrice(setNumber, condition, currency, preis);
    // Dieselbe Regel wie der Tages-Schnappschuss des Jobs: Ein Verlauf mit zwei
    // Aufnahmeregeln hätte Lücken.
    if (hatPrice({ avg_price: avg, qty_avg_price: qavg }))
      await t.preisCache.rememberSetHistory(setNumber, condition, currency, preis);
  });
  return preis;
}

export interface PriceData {
  min_price: number;
  avg_price: number;
  max_price: number;
  qty_avg_price: number;
  from_cache: boolean;
  condition_used?: string;
  is_fallback?: true;
  /** Frisch geprüft, aber BrickLink kennt keinen Preis. */
  no_price?: true;
  bl_unbekannt?: true;
  /** Nicht im Cache: Der Job „preise_nachladen“ holt ihn. */
  ausstehend?: true;
  error?: string;
}
type CacheRow = {
  min_price?: unknown;
  avg_price?: unknown;
  max_price?: unknown;
  qty_avg_price?: unknown;
  fetched_at?: string | Date | null;
};
const WITHOUT_PRICE = { min_price: 0, avg_price: 0, max_price: 0, qty_avg_price: 0 } as const;
const numberFrom = (v: unknown) => Number(v) || 0;
/** avg_price trägt den Marktpreis: Alle Verbraucher lesen es, eine 0 erschiene als „0.00“. */
const fromRow = (z: CacheRow, zusatz: Partial<PriceData> = {}): PriceData => ({
  min_price: numberFrom(z.min_price),
  avg_price: marketPriceFrom(z) ?? 0,
  max_price: numberFrom(z.max_price),
  qty_avg_price: numberFrom(z.qty_avg_price),
  from_cache: true,
  ...zusatz,
});

/** Was Set, Teil und Figur unterscheidet; den Ablauf teilen sich alle drei. */
interface Preisquelle {
  name: string;
  lies(zustand: string): Promise<CacheRow | null | undefined> | CacheRow | null | undefined;
  frage(zustand: string): Promise<PriceFuehrer | null | undefined>;
  remember(zustand: string, g: PriceFuehrer | null | undefined): Promise<CacheRow>;
}

/** null: Der Abruf scheiterte; ob das ein Fehler ist, entscheidet der Ablauf. */
async function callAb(q: Preisquelle, zustand: string): Promise<CacheRow | null> {
  try {
    return await q.remember(zustand, await q.frage(zustand));
  } catch (e) {
    // Ausnahme: fetchPriceWithFallback macht aus null den Rückfall oder einen Fachfehler.
    reportError(`preisabruf:${q.name} ${zustand}`, e);
    return null;
  }
}

/** „Kein Preis“ ist eine Antwort (no_price); scheitert jeder Abruf ohne frische Antwort im
 * Cache, ist das ein Fehler, damit die Merkliste „nicht geladen“ statt „keiner“ zeigt. */
async function fetchPriceWithFallback(
  k: FinancesContext,
  q: Preisquelle,
  zustand: string,
  ttl: number,
): Promise<PriceData> {
  const anderer = zustand === 'N' ? 'U' : 'N';
  const z = await q.lies(zustand);
  if (hatPrice(z)) return fromRow(z!);
  const knownEmpty = cacheUsable(z, ttl, k.uhr.jetzt());
  let pd: CacheRow | null = null;
  if (!knownEmpty) {
    if (!(await k.fremdquellen.quotaFree('bricklink')).allowed) fachfehler('zu_viele', 'bricklink_tageslimit');
    pd = await callAb(q, zustand);
    if (hatPrice(pd)) return fromRow(pd!, { from_cache: false, condition_used: zustand });
  }
  const zf = await q.lies(anderer);
  if (hatPrice(zf)) return fromRow(zf!, { condition_used: anderer, is_fallback: true });
  if (knownEmpty && cacheUsable(zf, ttl, k.uhr.jetzt())) return { ...WITHOUT_PRICE, from_cache: true, no_price: true };
  const frei = (await k.fremdquellen.quotaFree('bricklink')).allowed;
  const pd2 = frei ? await callAb(q, anderer) : null;
  if (hatPrice(pd2)) return fromRow(pd2!, { from_cache: false, condition_used: anderer, is_fallback: true });
  if (knownEmpty || pd || pd2) return { ...WITHOUT_PRICE, from_cache: !pd && !pd2, no_price: true };
  return frei ? fachfehler('nicht_gefunden', 'kein_bricklink_preis') : fachfehler('zu_viele', 'bricklink_tageslimit');
}

/** Beim Erfassen heisst ein gescheiterter Abruf „keiner“; das erschöpfte Kontingent bleibt ein Fehler. */
export async function priceOrNone(abruf: Promise<PriceData>): Promise<PriceData | null> {
  try {
    return await abruf;
  } catch (e) {
    if (e instanceof Fachfehler && e.code === 'kein_bricklink_preis') return null;
    throw e;
  }
}

const hours = (ttlHours: Stunden) => Math.max(1, parseInt(String(ttlHours), 10));

export async function fetchPrice(
  k: FinancesContext,
  setNumber: string,
  condition: string,
  guideType: string,
  currency: string,
  ttlHours: Stunden,
  pre: { catalog: Map<string, CatalogEntry>; cache: Map<string, SetPreiszeile> } | null = null,
): Promise<PriceData> {
  // withVersion() auch beim vorgeladenen Weg: Die Karte kommt aus catalog_cache,
  // also unter derselben Schreibweise wie die Tabelle.
  const catalogRow = pre?.catalog
    ? pre.catalog.get(withVersion(setNumber)) || null
    : await k.katalog.catalogEntry(setNumber);
  if (withoutBricklinkPrice(catalogRow))
    return { ...WITHOUT_PRICE, from_cache: true, no_price: true, bl_unbekannt: true };
  const ttl = hours(ttlHours);
  const quelle: Preisquelle = {
    name: `Price ${setNumber}`,
    lies: c =>
      pre?.cache ? pre.cache.get(`${setNumber}|${c}`) || null : priceFromCache(k, setNumber, c, currency, ttl),
    frage: c => k.katalog.priceGuide(setNumber, c, guideType, currency),
    remember: async (c, g) => {
      const p = await savePrice(k, setNumber, c, currency, g);
      console.log(`  Price ${setNumber} cond=${c}: avg=${p.avg} qty_avg=${p.qavg}`);
      return { min_price: p.min, avg_price: p.avg, max_price: p.max, qty_avg_price: p.qavg };
    },
  };
  return fetchPriceWithFallback(k, quelle, condition, ttl);
}

/** Nur der Cache: Eine Liste soll nicht auf BrickLink warten. Rückfall auf den anderen
 * Zustand; sind beide frisch leer, gibt es keinen Preis, fehlt einer, steht er aus. */
export function priceFromStock(
  lies: (zustand: 'N' | 'U') => CacheRow | null | undefined,
  zustand: 'N' | 'U',
  ttlStunden: number,
  jetzt: number,
): PriceData {
  const anderer = zustand === 'N' ? 'U' : 'N';
  const z = lies(zustand) ?? null;
  if (hatPrice(z)) return fromRow(z!);
  const zf = lies(anderer) ?? null;
  if (hatPrice(zf)) return fromRow(zf!, { condition_used: anderer, is_fallback: true });
  if (cacheUsable(z, ttlStunden, jetzt) && cacheUsable(zf, ttlStunden, jetzt))
    return { ...WITHOUT_PRICE, from_cache: true, no_price: true };
  return { ...WITHOUT_PRICE, from_cache: false, ausstehend: true };
}

export function setPriceFromStock(
  setNumber: string,
  zustand: 'N' | 'U',
  ttlStunden: number,
  jetzt: number,
  pre: { catalog: Map<string, unknown>; cache: Map<string, CacheRow> },
): PriceData {
  if (
    withoutBricklinkPrice(
      (pre.catalog.get(withVersion(setNumber)) as Parameters<typeof withoutBricklinkPrice>[0]) ?? null,
    )
  )
    return { ...WITHOUT_PRICE, from_cache: true, no_price: true, bl_unbekannt: true };
  return priceFromStock(c => pre.cache.get(`${setNumber}|${c}`), zustand, ttlStunden, jetzt);
}

export async function partKey(k: FinancesContext, partNumber: string, rbColorId: number): Promise<string> {
  return `${await resolveBlPartNumber(k, partNumber)}|${Number(await resolveBlColorId(k, rbColorId)) || 0}`;
}

export async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      const t = tasks[i];
      if (t) results[i] = await t();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// Gedächtnis für zwei Übersetzungstabellen, die sich während einer Bewertung
// nicht ändern; je Teil kostete die Abfrage sonst die meiste Zeit.
const SUPPLEMENT_TTL_MS = 10 * 60 * 1000;
// Beim Überschreiten wird geleert statt einzeln aufgeräumt: eine Handvoll
// Nutzer, kleine Tabellen (wie _tokenCache in src/konto/tokenCache.ts).
const SUPPLEMENT_MAX = 5000;

/** Ein `null` (nichts gefunden) wird nicht gemerkt. */
function nachschlagwerk<S, W>(uhr: Uhr, hole: (schluessel: S) => Promise<W | null>) {
  const karte = new Map<S, { wert: W; zeit: number }>();
  const frage = async (schluessel: S): Promise<W | null> => {
    const jetzt = uhr.jetzt();
    const treffer = karte.get(schluessel);
    if (treffer && jetzt - treffer.zeit < SUPPLEMENT_TTL_MS) return treffer.wert;
    const wert = await hole(schluessel);
    if (wert == null) {
      karte.delete(schluessel);
      return null;
    }
    if (karte.size >= SUPPLEMENT_MAX) karte.clear();
    karte.set(schluessel, { wert, zeit: jetzt });
    return wert;
  };
  // Kein Leeren: Die Quelltabellen werden nur ergänzt, ein Treffer bleibt richtig.
  frage.kennt = (schluessel: S) => {
    const treffer = karte.get(schluessel);
    return !!treffer && uhr.jetzt() - treffer.zeit < SUPPLEMENT_TTL_MS;
  };
  frage.merken = (schluessel: S, wert: W) => {
    if (karte.size >= SUPPLEMENT_MAX) karte.clear();
    karte.set(schluessel, { wert, zeit: uhr.jetzt() });
  };
  return frage;
}

/** Die ganze Tabelle (rund 200 Zeilen), einmal je Zugang geladen und geteilt: Je Schlüssel
 * bliebe jede unbekannte Farbe eine eigene Abfrage, parallele Bewerter lüden je selbst. */
type Farbstand = { karte: Map<number, number> | null; zeit: number; load: Promise<Map<number, number>> | null };
export async function farbkarte(k: FinancesContext): Promise<Map<number, number>> {
  const st = k.faecher.fach<Farbstand>('farbkarte', () => ({ karte: null, zeit: 0, load: null }));
  const jetzt = k.uhr.jetzt();
  if (st.karte && jetzt - st.zeit < SUPPLEMENT_TTL_MS) return st.karte;
  if (st.load) return st.load;
  st.load = (async () => {
    const rows = await k.preisCache.blFarben();
    const karte = new Map<number, number>();
    for (const r of rows) karte.set(Number(r.id), r.bl_color_id);
    // Eine LEERE Tabelle wird NICHT gemerkt: Vor dem ersten Abgleich ist sie leer,
    // und zehn Minuten jede Übersetzung zu verweigern hiesse, den Abgleich zu ignorieren.
    if (karte.size) Object.assign(st, { karte, zeit: jetzt });
    return karte;
  })();
  try {
    return await st.load;
  } finally {
    st.load = null;
  }
}

/** KEINE_FARBE ist bei BrickLink 0, Rebrickables 0 ist Schwarz. @returns null, wenn die Karte
 * nicht lesbar ist: Mit der Rebrickable-Farbe käme der Preis eines anderen Teils. */
export async function resolveBlColorId(k: FinancesContext, rbColorId: number): Promise<number | null> {
  if (rbColorId == null || rbColorId === KEINE_FARBE) return 0;
  const karte = await versuche('preise:farbkarte', farbkarte(k));
  if (!karte.ok) return null;
  const treffer = karte.wert.get(Number(rbColorId));
  return treffer != null ? Number(treffer) : rbColorId;
}

// Ohne Übersetzung antwortet BrickLink für RB-Nummern mit 404. Eine Quelle
// (bl_mapping), damit nicht zwei Orte auseinanderlaufen. Je Satz Dienste ein Gedächtnis.
const blTeil = (k: FinancesContext) =>
  k.faecher.fach('blTeil', () =>
    nachschlagwerk(k.uhr, (partNumber: string) => k.katalog.blFetchNumber('part', partNumber)),
  );

/** Mit `konto` zuerst dessen eigene Zuordnung (Migration 0094); sie geht am
 * gemeinsamen Gedächtnis vorbei, weil sie nur für dieses Konto gilt. */
export async function resolveBlPartNumber(k: FinancesContext, partNumber: string, konto: number | null = null) {
  // Ohne Fang: Mit der Rebrickable-Nummer käme der Preis eines anderen Teils.
  if (konto !== null) return (await k.katalog.blFetchNumber('part', partNumber, konto)) ?? partNumber;
  return (await blTeil(k)(partNumber)) ?? partNumber;
}

/** In zwei Abfragen, weil das Gedächtnis innerhalb einer Bewertung nicht hilft:
 * Jedes Teil hat eine andere Nummer. */
export async function loadBlNumbersBefore(k: FinancesContext, partNumbers: string[]): Promise<void> {
  const offen = [...new Set(partNumbers.filter(Boolean).map(String))].filter(n => !blTeil(k).kennt(n));
  if (!offen.length) return;
  // Die Abfrage steht in src/katalog/blZuordnung.ts.
  for (const [rb, bl] of await k.katalog.blFetchNumbers('part', offen)) blTeil(k).merken(rb, bl);
}

/** Sonst fragte jedes Teil je Zustand einzeln. Schlüssel wie in fetchPartPrice:
 * BrickLink-Nummer|BrickLink-Farbe|Zustand. */
export async function ladeTeilepreiseVor(
  k: FinancesContext,
  teile: { partNumber: string; rbColorId: number }[],
  currency: string,
  ttlHours: Stunden,
): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours), 10));
  const nummern: string[] = [],
    farben: number[] = [];
  for (const t of teile) {
    const farbe = await resolveBlColorId(k, t.rbColorId);
    if (farbe === null) continue;
    nummern.push(await resolveBlPartNumber(k, t.partNumber));
    farben.push(farbe);
  }
  const vorrat = new Map<string, Preiszeile>();
  if (!nummern.length) return vorrat;
  const zeilen = await k.preisCache.partsPricesFresh(nummern, farben, currency, ttl);
  for (const z of zeilen) vorrat.set(`${z.part_number}|${z.color_id}|${z.condition}`, z);
  return vorrat;
}

/** Wie ladeTeilepreiseVor, für Figuren — nur echte BrickLink-Preise. */
export async function ladeFigurenpreiseVor(
  k: FinancesContext,
  figuren: string[],
  currency: string,
  ttlHours: Stunden,
): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours), 10));
  const vorrat = new Map<string, Preiszeile>();
  if (!figuren.length) return vorrat;
  const zeilen = await k.preisCache.minifigsPricesFresh([...new Set(figuren)], currency, ttl);
  for (const z of zeilen) vorrat.set(`${z.fig_number}|${z.condition}`, z);
  return vorrat;
}

/** Erst Verkäufe, sonst Angebote: Bei Teilen in seltenen Farben ist „kein Verkauf
 * in sechs Monaten“ der Normalfall. */
async function questionPriceGuide(
  k: FinancesContext,
  pfad: string,
  zustand: string,
  currency: string,
  extra: Record<string, string> = {},
) {
  const qp = { guide_type: 'sold', new_or_used: zustand, currency_code: currency, vat: 'N', ...extra };
  const g = await k.fremdquellen.quellen.bricklinkRequest('GET', pfad, qp);
  if (hatPrice(g)) return g;
  const alt = await versuche(
    'preise:alt',
    k.fremdquellen.quellen.bricklinkRequest('GET', pfad, { ...qp, guide_type: 'stock' }),
  );
  return alt.ok && hatPrice(alt.wert) ? alt.wert : g;
}

type Schreiber = (avg: number, qavg: number) => Promise<unknown>;

/** Auch eine Null wird gemerkt (hält den Abruf zurück); ein Nullpunkt im Verlauf sähe aus wie ein Kurssturz. */
async function rememberWithHistory(
  g: PriceFuehrer | null | undefined,
  ort: string,
  cache: Schreiber,
  verlauf: Schreiber,
) {
  const zeile = { avg_price: numberFrom(g?.avg_price), qty_avg_price: numberFrom(g?.qty_avg_price) };
  await cache(zeile.avg_price, zeile.qty_avg_price);
  if (hatPrice(zeile)) await verlauf(zeile.avg_price, zeile.qty_avg_price).catch(logAndContinue(ort));
  return zeile;
}

/** Nummer und Farbe übersetzt für Cache, Abruf und Schreiben, sonst passten sie nicht zueinander.
 * @param vorrat aus ladeTeilepreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
export async function fetchPartPrice(
  k: FinancesContext,
  partNumber: string,
  rbColorId: number,
  condition: string,
  currency: string,
  ttlHours: Stunden,
  vorrat: Map<string, Preiszeile> | null = null,
  konto: number | null = null,
): Promise<PriceData> {
  const farbe = await resolveBlColorId(k, rbColorId);
  if (farbe === null) fachfehler('nicht_gefunden', 'kein_bricklink_preis');
  const nummer = await resolveBlPartNumber(k, partNumber, konto);
  const f = Number(farbe) || 0;
  const ttl = hours(ttlHours);
  const cache = k.preisCache;
  const quelle: Preisquelle = {
    name: `Part price ${partNumber}${nummer !== partNumber ? ` (bl ${nummer})` : ''} color ${farbe} (rb color ${rbColorId})`,
    lies: c =>
      vorrat ? (vorrat.get(`${nummer}|${f}|${c}`) ?? null) : cache.partPriceFresh(nummer, f, c, currency, ttl),
    frage: c =>
      questionPriceGuide(k, `/items/part/${nummer}/price`, c, currency, farbe ? { color_id: String(farbe) } : {}),
    remember: (c, g) =>
      rememberWithHistory(
        g,
        'preise:teileverlauf schreiben',
        (avg, qavg) => cache.rememberPartPrice(nummer, f, c, currency, avg, qavg),
        (avg, qavg) => cache.rememberPartHistory(nummer, f, c, currency, avg, qavg),
      ),
  };
  return fetchPriceWithFallback(k, quelle, condition, ttl);
}

/** Wie fetchPartPrice; gelesen werden nur echte BrickLink-Preise, keine Schätzungen.
 * @param vorrat aus ladeFigurenpreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
export async function fetchMinifigPrice(
  k: FinancesContext,
  figNumber: string,
  condition: string,
  currency: string,
  ttlHours: Stunden,
  vorrat: Map<string, Preiszeile> | null = null,
): Promise<PriceData> {
  const ttl = hours(ttlHours);
  const cache = k.preisCache;
  const quelle: Preisquelle = {
    name: `Minifig price ${figNumber}`,
    lies: c =>
      vorrat ? (vorrat.get(`${figNumber}|${c}`) ?? null) : cache.minifigPriceFresh(figNumber, c, currency, ttl),
    frage: c => questionPriceGuide(k, `/items/minifig/${figNumber}/price`, c, currency),
    remember: (c, g) =>
      rememberWithHistory(
        g,
        'preise:figurverlauf schreiben',
        (avg, qavg) => cache.rememberMinifigPrice(figNumber, c, currency, avg, qavg),
        (avg, qavg) => cache.rememberMinifigHistory(figNumber, c, currency, avg, qavg),
      ),
  };
  return fetchPriceWithFallback(k, quelle, condition, ttl);
}
