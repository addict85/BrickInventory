/** Die PREISSCHICHT des Finanzteils: BrickLink, Preis-Cache, Tageskontingent
 * und BL-Nummern. Eigene Datei, weil Bewertung und Gewinnrechnung auf ihr
 * stehen, nicht umgekehrt. */

import type { DbSchnittstelle } from '../../../db/database';
import type { Preiszeile, SetPreiszeile } from '../repository/preisCache';
import { type KatalogEintrag, checkAndIncrementRateLimit, kontingentFrei, getLimitForApi, getRateLimitStatus, bricklinkRequest, katalogEintrag, getPriceGuide, hatPreis, blAbrufNummer, blAbrufNummern } from '../../katalog';
import { asIds } from '../../haushalt';
import { fehlertext, logAndContinue } from '../../infra/fehler';
import { fachfehler } from '../../infra/fehlerTexte';
import { mitVersion, ohneBricklinkPreis } from '../../infra/setNummer';
import { effectiveCondition } from './zustand';
import { KEINE_FARBE } from '../../infra/validate';
import { versuche } from '../../infra/ergebnis';
import { finanzenBereich } from '../prozess';
import type { FinanzenDienste } from '../bereich';
import type { KatalogDienste } from '../../katalog';

/** Wessen Cache und Katalog der Preisweg liest und schreibt. Ein Bereich mit eigenem
 * Zugang (Sets) reicht seinen durch; ohne Angabe gilt der des Prozesses. Abruf und
 * Tageskontingent bei BrickLink bleiben prozessweit: Sie hängen am API-Schlüssel. */
export interface PreisZugang {
  finanzen: FinanzenDienste;
  katalog?: KatalogDienste | undefined;
}

/** Wessen DATEN gerechnet werden; wessen EINSTELLUNGEN gelten, sagt `viewerId`. */
export type { Blickfeld } from '../../haushalt';

type PreisZeile = { avg_price?: unknown; fetched_at?: string | Date | null } | null | undefined;

/** `string | number`, weil die Einstellung als Text aus der Datenbank kommt;
 * das `parseInt(String(…))` der Rechner ist deshalb tragend. */
type Stunden = string | number;

/** DIE Zustandsauflösung für ein Set — eine, weil mehrere eigene Fassungen
 * auseinandergelaufen waren. */
export async function resolveSetCondition(
  uid: number | number[], setNumber: string, dbh?: Pick<DbSchnittstelle, 'get'>,
  f: FinanzenDienste = finanzenBereich(),
): Promise<'N' | 'U'> {
  // Blickfeld statt nackter ID: Das Set gehört oft einem Unterkonto. `dbh`:
  // Wer in einer Transaktion fragt, liest auch darin (priceForNewAcquisition).
  const row = await f.preisCache.setZustandsZaehler(asIds(uid), setNumber, dbh);
  return effectiveCondition(row);
}

// 'U', weil der Gebrauchtpreis dem Wiederverkaufswert der Sammlung entspricht;
// der andere Zustand dient als Rückfall.
export const DEFAULT_PRICE_CONDITION = 'U';

/** Kürzer als das TTL-Fenster, damit ein Rückfall (sold → stock) überhaupt
 * wieder angefragt wird. */
const ZERO_PRICE_TTL_HOURS = 6;

/** Die eine Stelle, die „frisch" festlegt. */
export function leerePreisCache(): Promise<void> {
  return finanzenBereich().preisCache.loescheAlleSetPreise();
}

export async function preisAusCache(setNumber: string, condition: string, currency: string, ttlStunden: number,
  f: FinanzenDienste = finanzenBereich()) {
  return f.preisCache.setPreisFrisch(setNumber, condition, currency, ttlStunden);
}

export function cacheUsable(row: PreisZeile, ttlHours: number) {
  if (!row) return false;
  // avg_price ist numeric, und pg liefert numeric als Zeichenkette.
  if (hatPreis(row)) return true;
  // 0-Eintrag: nur kurz vertrauen, danach neu versuchen.
  if (!row.fetched_at) return false;
  const ageH = (Date.now() - new Date(row.fetched_at).getTime()) / 3600000;
  return ageH < Math.min(ZERO_PRICE_TTL_HOURS, ttlHours);
}

interface PreisFuehrer { min_price?: unknown; avg_price?: unknown; max_price?: unknown; qty_avg_price?: unknown; total_quantity?: unknown; }

/** Erst Cache, dann — nur mit Preis — Verlaufspunkt; eine Funktion, weil drei
 * Fassungen derselben Regel auseinandergelaufen waren.
 * @returns die gelesenen Zahlen, damit der Aufrufer nicht erneut umwandeln muss */
export async function speicherePreis(setNumber: string, condition: string, currency: string, g: PreisFuehrer | null | undefined,
  f: FinanzenDienste = finanzenBereich()) {
  const min  = parseFloat(String(g?.min_price     ?? 0)) || 0;
  const avg  = parseFloat(String(g?.avg_price     ?? 0)) || 0;
  const max  = parseFloat(String(g?.max_price     ?? 0)) || 0;
  const qavg = parseFloat(String(g?.qty_avg_price ?? 0)) || 0;
  const qty  = parseInt(String(g?.total_quantity  ?? 0)) || 0;

  // Auch eine Null wird geschrieben: Sie ist die Auskunft „kein Preis" und hält
  // den nächsten Abruf zurück; wie lange, entscheidet cacheUsable().
  const preis = { min, avg, max, qavg, qty };
  await f.preisCache.merkeSetPreis(setNumber, condition, currency, preis);

  // Weiter als hatPreis(), absichtlich dieselbe Regel wie der Tages-Schnappschuss
  // des Jobs: Ein Verlauf mit zwei Aufnahmeregeln hätte Lücken.
  if (avg > 0 || qavg > 0) {
    await f.preisCache.merkeSetVerlauf(setNumber, condition, currency, preis).catch(logAndContinue('preise:setverlauf schreiben'));
  }
  return preis;
}

export async function fetchPrice(setNumber: string, condition: string, guideType: string, currency: string, ttlHours: Stunden, pre: { catalog: Map<string, KatalogEintrag>; cache: Map<string, SetPreiszeile> } | null = null,
  z: PreisZugang = { finanzen: finanzenBereich() }) {
  // mitVersion() auch beim vorgeladenen Weg: Die Karte kommt aus catalog_cache,
  // also unter derselben Schreibweise wie die Tabelle.
  const catalogRow = pre?.catalog
    ? (pre.catalog.get(mitVersion(setNumber)) || null)
    : await katalogEintrag(setNumber, z.katalog);
  if (ohneBricklinkPreis(catalogRow))
    return { min_price:0, avg_price:0, max_price:0, qty_avg_price:0, from_cache:true, no_price:true, bl_unbekannt:true };

  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const cached = pre?.cache
    ? (pre.cache.get(`${setNumber}|${condition}`) || null)
    : await preisAusCache(setNumber, condition, currency, ttl, z.finanzen);
  if (cached && hatPreis(cached))
    return { min_price: cached.min_price, avg_price: cached.avg_price, max_price: cached.max_price, qty_avg_price: cached.qty_avg_price, from_cache: true };

  // Frischer 0-Eintrag: erst den anderen Zustand aus dem Cache versuchen. Ist er
  // älter, wird unten neu geholt, mit dem sold→stock-Rückfall.
  if (cached && !hatPreis(cached) && cacheUsable(cached, ttl)) {
    const cachedFb = pre?.cache
      ? (pre.cache.get(`${setNumber}|${fallbackCondition}`) || null)
      : await preisAusCache(setNumber, fallbackCondition, currency, ttl, z.finanzen);
    // Dieselbe Regel wie der Leser (src/finanzen/preisRegel.ts).
    if (cachedFb && hatPreis(cachedFb))
      return { min_price: cachedFb.min_price, avg_price: cachedFb.avg_price, max_price: cachedFb.max_price, qty_avg_price: cachedFb.qty_avg_price, from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    // Nur wenn auch der andere Zustand frisch geprüft ist, gilt das Set als
    // preislos; sonst bliebe Finanzen ohne Abruf leer.
    if (!cacheUsable(cachedFb, ttl)) {
      const rl = await kontingentFrei('bricklink');
      const fb = rl.allowed ? await tryFetch(fallbackCondition) : null;
      if (hatPreis(fb)) return { ...fb, condition_used: fallbackCondition, is_fallback: true };
    }
    return { min_price:0, avg_price:0, max_price:0, qty_avg_price:0, from_cache:true, no_price:true };
  }

  async function tryFetch(cond: string) {
    try {
      // Lazy-Require gegen einen Require-Zyklus (bricklink nutzt den Rate-Limiter von hier).
      const g = await getPriceGuide(setNumber, cond, guideType, currency);
      const { min, avg, max, qavg } = await speicherePreis(setNumber, cond, currency, g, z.finanzen);
      console.log(`  Price ${setNumber} cond=${cond}: avg=${avg} qty_avg=${qavg}`);
      return { min_price:min, avg_price:avg, max_price:max, qty_avg_price:qavg, from_cache:false };
    } catch (e) { console.log(`  Price ${setNumber} cond=${cond} error: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')); return null; }
  }

  const rl1 = await kontingentFrei('bricklink');
  if (!rl1.allowed) fachfehler('zu_viele', 'bricklink_tageslimit');

  const pd = await tryFetch(condition);
  // An avg_price festgemacht, weil alle Verbraucher diesen Wert lesen.
  if (pd && hatPreis(pd)) return { ...pd, condition_used: condition };

  const cachedFallback = await preisAusCache(setNumber, fallbackCondition, currency, ttl, z.finanzen);
  if (cachedFallback && hatPreis(cachedFallback))
    return { min_price: cachedFallback.min_price, avg_price: cachedFallback.avg_price, max_price: cachedFallback.max_price, qty_avg_price: cachedFallback.qty_avg_price, from_cache: true, condition_used: fallbackCondition, is_fallback: true };

  const rl2 = await kontingentFrei('bricklink');
  if (!rl2.allowed) { if (pd) return { ...pd, condition_used: condition }; fachfehler('zu_viele', 'bricklink_tageslimit'); }

  const pd2 = await tryFetch(fallbackCondition);
  if (pd2 && hatPreis(pd2)) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd) return { ...pd, condition_used: condition };
  fachfehler('nicht_gefunden', 'kein_bricklink_preis');
}

export interface PreisDaten {
  min_price: number; avg_price: number; max_price: number; qty_avg_price: number;
  from_cache: boolean;
  condition_used?: 'N' | 'U';
  is_fallback?: true;
  /** Frisch geprüft, aber BrickLink kennt keinen Preis. */
  no_price?: true;
  bl_unbekannt?: true;
  /** Nicht im Cache: Der Job „preise_nachladen“ holt ihn. */
  ausstehend?: true;
  error?: string;
}
type CacheZeile = { min_price?: unknown; avg_price?: unknown; max_price?: unknown; qty_avg_price?: unknown; fetched_at?: string | Date | null };
const OHNE_PREIS = { min_price: 0, avg_price: 0, max_price: 0, qty_avg_price: 0 } as const;
const zahlAus = (v: unknown) => Number(v) || 0;
const ausZeile = (z: CacheZeile, zusatz: Partial<PreisDaten> = {}): PreisDaten => ({
  min_price: zahlAus(z.min_price), avg_price: zahlAus(z.avg_price), max_price: zahlAus(z.max_price),
  qty_avg_price: zahlAus(z.qty_avg_price), from_cache: true, ...zusatz });

/** Nur der Cache: Eine Liste soll nicht auf BrickLink warten. Rückfall auf den anderen
 * Zustand; sind beide frisch leer, gibt es keinen Preis, fehlt einer, steht er aus. */
export function preisAusVorrat(lies: (zustand: 'N' | 'U') => CacheZeile | null | undefined,
                               zustand: 'N' | 'U', ttlStunden: number): PreisDaten {
  const anderer = zustand === 'N' ? 'U' : 'N';
  const z = lies(zustand) ?? null;
  if (hatPreis(z)) return ausZeile(z!);
  const zf = lies(anderer) ?? null;
  if (hatPreis(zf)) return ausZeile(zf!, { condition_used: anderer, is_fallback: true });
  if (cacheUsable(z, ttlStunden) && cacheUsable(zf, ttlStunden)) return { ...OHNE_PREIS, from_cache: true, no_price: true };
  return { ...OHNE_PREIS, from_cache: false, ausstehend: true };
}

export function setPreisAusVorrat(setNumber: string, zustand: 'N' | 'U', ttlStunden: number,
                                  pre: { catalog: Map<string, unknown>; cache: Map<string, CacheZeile> }): PreisDaten {
  if (ohneBricklinkPreis(pre.catalog.get(mitVersion(setNumber)) as Parameters<typeof ohneBricklinkPreis>[0] ?? null))
    return { ...OHNE_PREIS, from_cache: true, no_price: true, bl_unbekannt: true };
  return preisAusVorrat(c => pre.cache.get(`${setNumber}|${c}`), zustand, ttlStunden);
}

export async function teilSchluessel(partNumber: string, rbColorId: number): Promise<string> {
  return `${await resolveBlPartNumber(partNumber)}|${Number(await resolveBlColorId(rbColorId)) || 0}`;
}

export async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results = new Array(tasks.length); let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; const t = tasks[i]; if (t) results[i] = await t(); } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// Gedächtnis für zwei Übersetzungstabellen, die sich während einer Bewertung
// nicht ändern; je Teil kostete die Abfrage sonst die meiste Zeit.
const NACHSCHLAG_TTL_MS = 10 * 60 * 1000;
// Beim Überschreiten wird geleert statt einzeln aufgeräumt: eine Handvoll
// Nutzer, kleine Tabellen (wie _tokenCache in src/konto/tokenCache.ts).
const NACHSCHLAG_MAX = 5000;

/** Ein `null` (nichts gefunden) wird nicht gemerkt. */
function nachschlagwerk<S, W>(hole: (schluessel: S) => Promise<W | null>) {
  const karte = new Map<S, { wert: W; zeit: number }>();
  const frage = async (schluessel: S): Promise<W | null> => {
    const jetzt = Date.now();
    const treffer = karte.get(schluessel);
    if (treffer && jetzt - treffer.zeit < NACHSCHLAG_TTL_MS) return treffer.wert;
    const wert = await hole(schluessel);
    if (wert == null) { karte.delete(schluessel); return null; }
    if (karte.size >= NACHSCHLAG_MAX) karte.clear();
    karte.set(schluessel, { wert, zeit: jetzt });
    return wert;
  };
  // Kein Leeren: Die Quelltabellen werden nur ergänzt, ein Treffer bleibt richtig.
  frage.kennt = (schluessel: S) => {
    const treffer = karte.get(schluessel);
    return !!treffer && Date.now() - treffer.zeit < NACHSCHLAG_TTL_MS;
  };
  frage.merken = (schluessel: S, wert: W) => {
    if (karte.size >= NACHSCHLAG_MAX) karte.clear();
    karte.set(schluessel, { wert, zeit: Date.now() });
  };
  return frage;
}

/** Die ganze Tabelle (rund 200 Zeilen): Je Schlüssel bliebe eine unbekannte
 * Farbe je Teil eine eigene Abfrage, weil Fehlschläge nicht gemerkt werden. */
// Der Ladevorgang wird geteilt, nicht nur sein Ergebnis: Parallele Bewerter
// lüden sonst je selbst. Je Zugang, weil die Karte aus seiner Datenbank kommt.
type Farbstand = { karte: Map<number, number> | null; zeit: number; ladung: Promise<Map<number, number>> | null };
export async function farbkarte(): Promise<Map<number, number>> {
  const st = finanzenBereich().faecher.fach<Farbstand>('farbkarte', () => ({ karte: null, zeit: 0, ladung: null }));
  const jetzt = Date.now();
  if (st.karte && jetzt - st.zeit < NACHSCHLAG_TTL_MS) return st.karte;
  if (st.ladung) return st.ladung;
  st.ladung = (async () => {
    const rows = await finanzenBereich().preisCache.blFarben();
    const karte = new Map<number, number>();
    for (const r of rows) karte.set(Number(r.id), r.bl_color_id);
    // Eine LEERE Tabelle wird NICHT gemerkt: Vor dem ersten Abgleich ist sie leer,
    // und zehn Minuten jede Übersetzung zu verweigern hiesse, den Abgleich zu ignorieren.
    if (karte.size) Object.assign(st, { karte, zeit: jetzt });
    return karte;
  })();
  try { return await st.ladung; }
  finally { st.ladung = null; }
}

/** KEINE_FARBE ist bei BrickLink 0 („(Not Applicable)"); Rebrickables 0 ist
 * Schwarz und geht über die Karte. */
/** @returns null, wenn die Karte nicht lesbar ist: Die Rebrickable-Nummer als
 * BrickLink-Farbe hiesse, einen falschen Preis zu holen und falsch zu merken. */
export async function resolveBlColorId(rbColorId: number): Promise<number | null> {
  if (rbColorId == null || rbColorId === KEINE_FARBE) return 0;
  const karte = await versuche('preise:farbkarte', farbkarte());
  if (!karte.ok) return null;
  const treffer = karte.wert.get(Number(rbColorId));
  return treffer != null ? Number(treffer) : rbColorId;
}

// Ohne Übersetzung antwortet BrickLink für RB-Nummern mit 404. Eine Quelle
// (bl_zuordnung), damit nicht zwei Orte auseinanderlaufen.
const _blTeil = nachschlagwerk(async (partNumber: string) => {
  return await blAbrufNummer('part', partNumber);
});

/** Mit `konto` zuerst dessen eigene Zuordnung (Migration 0094); sie geht am
 * gemeinsamen Gedächtnis vorbei, weil sie nur für dieses Konto gilt. */
export async function resolveBlPartNumber(partNumber: string, konto: number | null = null) {
  // Ohne Fang: Mit der Rebrickable-Nummer käme der Preis eines anderen Teils.
  if (konto !== null) return (await blAbrufNummer('part', partNumber, konto)) ?? partNumber;
  return (await _blTeil(partNumber)) ?? partNumber;
}

/** In zwei Abfragen, weil das Gedächtnis innerhalb einer Bewertung nicht hilft:
 * Jedes Teil hat eine andere Nummer. */
export async function ladeBlNummernVor(teilnummern: string[]): Promise<void> {
  const offen = [...new Set(teilnummern.filter(Boolean).map(String))].filter(n => !_blTeil.kennt(n));
  if (!offen.length) return;
  // Die Abfrage steht in src/katalog/blZuordnung.ts.
  for (const [rb, bl] of await blAbrufNummern('part', offen)) _blTeil.merken(rb, bl);
}

/** Sonst fragte jedes Teil je Zustand einzeln. Schlüssel wie in fetchPartPrice:
 * BrickLink-Nummer|BrickLink-Farbe|Zustand. */
export async function ladeTeilepreiseVor(teile: { partNumber: string; rbColorId: number }[],
                                  currency: string, ttlHours: Stunden): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const nummern: string[] = [], farben: number[] = [];
  for (const t of teile) {
    const farbe = await resolveBlColorId(t.rbColorId);
    if (farbe === null) continue;
    nummern.push(await resolveBlPartNumber(t.partNumber));
    farben.push(farbe);
  }
  const vorrat = new Map<string, Preiszeile>();
  if (!nummern.length) return vorrat;
  const zeilen = await finanzenBereich().preisCache.teilepreiseFrisch(nummern, farben, currency, ttl);
  for (const z of zeilen) vorrat.set(`${z.part_number}|${z.color_id}|${z.condition}`, z);
  return vorrat;
}

/** Wie ladeTeilepreiseVor, für Figuren — nur echte BrickLink-Preise. */
export async function ladeFigurenpreiseVor(figuren: string[], currency: string, ttlHours: Stunden): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const vorrat = new Map<string, Preiszeile>();
  if (!figuren.length) return vorrat;
  const zeilen = await finanzenBereich().preisCache.figurenpreiseFrisch([...new Set(figuren)], currency, ttl);
  for (const z of zeilen) vorrat.set(`${z.fig_number}|${z.condition}`, z);
  return vorrat;
}

/** Ein Teile- oder Figurenpreis; condition_used nennt den Zustand, aus dem er kam. */
export interface PreisErgebnis {
  avg_price: number; qty_avg_price: number; from_cache: boolean;
  condition_used?: string; is_fallback?: boolean; no_price?: boolean; error?: string; error_code?: string;
}

/** Mit Rückfall auf den anderen Zustand (viele ältere Teile gibt es nur
 * gebraucht). Nummer und Farbe werden zuerst übersetzt und dann für Cache,
 * Abruf und Schreiben benutzt — sonst passten Cache und Anfrage nicht.
 * @param vorrat aus ladeTeilepreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
export async function fetchPartPrice(partNumber: string, rbColorId: number, condition: string, currency: string, ttlHours: Stunden,
                              vorrat: Map<string, Preiszeile> | null = null, konto: number | null = null): Promise<PreisErgebnis> {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const colorId = await resolveBlColorId(rbColorId);
  if (colorId === null) return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'Farbe nicht zuordenbar' };
  const blPartNumber = await resolveBlPartNumber(partNumber, konto);
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const readCache = async (cond: string) => vorrat
    ? (vorrat.get(`${blPartNumber}|${Number(colorId) || 0}|${cond}`) ?? null)
    : finanzenBereich().preisCache.teilpreisFrisch(blPartNumber, Number(colorId) || 0, cond, currency, ttl);

  const cached = await readCache(condition);
  if (cached && hatPreis(cached))
    return { avg_price: parseFloat(String(cached.avg_price)), qty_avg_price: parseFloat(String(cached.qty_avg_price)), from_cache: true };

  // Ist der Rückfall noch nie geholt, NICHT aufgeben, sondern unten live
  // nachholen — nur den bekannt leeren Primärzustand überspringen.
  let skipPrimaryFetch = false;
  if (cached && !hatPreis(cached)) {
    const cachedFb = await readCache(fallbackCondition);
    if (cachedFb && hatPreis(cachedFb))
      return { avg_price: parseFloat(String(cachedFb.avg_price)), qty_avg_price: parseFloat(String(cachedFb.qty_avg_price)), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    if (cachedFb) return { avg_price: 0, qty_avg_price: 0, from_cache: true, no_price: true };
    skipPrimaryFetch = true;
  }

  async function tryFetch(cond: string) {
    try {
      const qp: Record<string, string> = { guide_type: 'sold', new_or_used: cond, currency_code: currency, vat: 'N' };
      if (colorId && colorId !== 0) qp.color_id = String(colorId);
      let g = await bricklinkRequest('GET', `/items/part/${blPartNumber}/price`, qp);
      // Kein Verkauf in sechs Monaten → aktuelle Angebote. Bei Teilen in seltenen
      // Farben ist das der Normalfall.
      if (!hatPreis(g)) {
        const alt = await versuche('preise:alt', bricklinkRequest('GET', `/items/part/${blPartNumber}/price`,
          { ...qp, guide_type: 'stock' }));
        if (alt.ok && hatPreis(alt.wert)) g = alt.wert;
      }
      const avg  = parseFloat(g?.avg_price || 0);
      const qavg = parseFloat(g?.qty_avg_price || 0);
      await finanzenBereich().preisCache.merkeTeilpreis(blPartNumber, Number(colorId) || 0, cond, currency, avg, qavg);
      // Der Cache hält nur den letzten Wert; ohne Verlaufspunkt gäbe es keine Kurve.
      if (avg > 0 || qavg > 0) {
        await finanzenBereich().preisCache.merkeTeilVerlauf(blPartNumber, Number(colorId) || 0, cond, currency, avg, qavg)
          .catch(logAndContinue('preise:teileverlauf schreiben'));
      }
      return { avg_price: avg, qty_avg_price: qavg, from_cache: false };
    } catch (e) {
      console.log(`  Part price failed ${partNumber}${blPartNumber !== partNumber ? ` (bl ${blPartNumber})` : ''} color ${colorId} (rb color ${rbColorId}) cond=${cond}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return null;
    }
  }

  let pd: Awaited<ReturnType<typeof tryFetch>> = null;
  if (!skipPrimaryFetch) {
    const rl1 = await kontingentFrei('bricklink');
    if (!rl1.allowed) fachfehler('zu_viele', 'bricklink_tageslimit');
    pd = await tryFetch(condition);
    if (pd && hatPreis(pd)) return { ...pd, condition_used: condition };

    const cachedFallback = await readCache(fallbackCondition);
    if (cachedFallback && hatPreis(cachedFallback))
      return { avg_price: parseFloat(String(cachedFallback.avg_price)), qty_avg_price: parseFloat(String(cachedFallback.qty_avg_price)), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
  }

  const rl2 = await kontingentFrei('bricklink');
  if (!rl2.allowed) {
    if (pd) return { ...pd, condition_used: condition };
    fachfehler('zu_viele', 'bricklink_tageslimit');
  }

  const pd2 = await tryFetch(fallbackCondition);
  if (pd2 && hatPreis(pd2)) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd2) return { ...pd2, condition_used: fallbackCondition };
  if (pd)  return { ...pd, condition_used: condition };
  // KEINE Nutzermeldung, sondern ein Merkmal: Der Preis-Job zählt daran
  // „übersprungen" statt „Fehler". Deshalb bewusst unübersetzt.
  return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'kein BrickLink-Preis gefunden', error_code: 'kein_bricklink_preis' };
}

/** Rückfall wie bei fetchPartPrice ('U' ↔ 'N').
 * @param vorrat aus ladeFigurenpreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
export async function fetchMinifigPrice(figNumber: string, condition: string, currency: string, ttlHours: Stunden,
                                 vorrat: Map<string, Preiszeile> | null = null): Promise<PreisErgebnis> {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const readCache = async (cond: string) => vorrat
    ? (vorrat.get(`${figNumber}|${cond}`) ?? null)
    : finanzenBereich().preisCache.figurpreisFrisch(figNumber, cond, currency, ttl);

  const cached = await readCache(condition);
  if (cached && hatPreis(cached))
    return { avg_price: parseFloat(String(cached.avg_price)), qty_avg_price: parseFloat(String(cached.qty_avg_price)), from_cache: true };

  let skipPrimaryFetch = false;
  if (cached && !hatPreis(cached)) {
    const cachedFb = await readCache(fallbackCondition);
    if (cachedFb && hatPreis(cachedFb))
      return { avg_price: parseFloat(String(cachedFb.avg_price)), qty_avg_price: parseFloat(String(cachedFb.qty_avg_price)), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    if (cachedFb) return { avg_price: 0, qty_avg_price: 0, from_cache: true, no_price: true };
    skipPrimaryFetch = true;
  }

  async function tryFetch(cond: string) {
    try {
      const qp = { guide_type: 'sold', new_or_used: cond, currency_code: currency, vat: 'N' };
      let g = await bricklinkRequest('GET', `/items/minifig/${figNumber}/price`, qp);
      if (!hatPreis(g)) {
        const alt = await versuche('preise:alt', bricklinkRequest('GET', `/items/minifig/${figNumber}/price`,
          { ...qp, guide_type: 'stock' }));
        if (alt.ok && hatPreis(alt.wert)) g = alt.wert;
      }
      const avg  = parseFloat(g?.avg_price || 0);
      const qavg = parseFloat(g?.qty_avg_price || 0);
      await finanzenBereich().preisCache.merkeFigurpreis(figNumber, cond, currency, avg, qavg);
      // Der Cache hält nur den letzten Wert; ohne Verlaufspunkt gäbe es keine Kurve.
      if (avg > 0 || qavg > 0) {
        await finanzenBereich().preisCache.merkeFigurVerlauf(figNumber, cond, currency, avg, qavg)
          .catch(logAndContinue('preise:figurverlauf schreiben'));
      }
      return { avg_price: avg, qty_avg_price: qavg, from_cache: false };
    } catch (e) {
      console.log(`  Minifig price failed ${figNumber} cond=${cond}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return null;
    }
  }

  let pd: Awaited<ReturnType<typeof tryFetch>> = null;
  if (!skipPrimaryFetch) {
    const rl1 = await kontingentFrei('bricklink');
    if (!rl1.allowed) fachfehler('zu_viele', 'bricklink_tageslimit');
    pd = await tryFetch(condition);
    if (pd && hatPreis(pd)) return { ...pd, condition_used: condition };

    const cachedFallback = await readCache(fallbackCondition);
    if (cachedFallback && hatPreis(cachedFallback))
      return { avg_price: parseFloat(String(cachedFallback.avg_price)), qty_avg_price: parseFloat(String(cachedFallback.qty_avg_price)), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
  }

  const rl2 = await kontingentFrei('bricklink');
  if (!rl2.allowed) {
    if (pd) return { ...pd, condition_used: condition };
    fachfehler('zu_viele', 'bricklink_tageslimit');
  }

  const pd2 = await tryFetch(fallbackCondition);
  if (pd2 && hatPreis(pd2)) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd2) return { ...pd2, condition_used: fallbackCondition };
  if (pd)  return { ...pd, condition_used: condition };
  return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'kein BrickLink-Preis gefunden', error_code: 'kein_bricklink_preis' };
}

export { checkAndIncrementRateLimit, kontingentFrei, getLimitForApi, getRateLimitStatus };
