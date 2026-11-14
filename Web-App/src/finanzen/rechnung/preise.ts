/** Die PREISSCHICHT des Finanzteils: BrickLink, Preis-Cache, Tageskontingent
 * und BL-Nummern. Eigene Datei, weil Bewertung und Gewinnrechnung auf ihr
 * stehen, nicht umgekehrt. */

import type { DbSchnittstelle } from '../../../db/database';
import type { Preiszeile, SetPreiszeile } from '../repository/preisCache';
import { type KatalogEintrag, hatPreis, marktpreisAus } from '../../katalog';
import { asIds } from '../../haushalt';
import { fehlertext, logAndContinue } from '../../infra/fehler';
import { Fachfehler, fachfehler } from '../../infra/fehlerTexte';
import { mitVersion, ohneBricklinkPreis } from '../../infra/setNummer';
import { effectiveCondition } from './zustand';
import { KEINE_FARBE } from '../../infra/validate';
import { versuche } from '../../infra/ergebnis';
import type { FinanzenKontext } from '../kontext';

/** Wessen DATEN gerechnet werden; wessen EINSTELLUNGEN gelten, sagt `viewerId`. */
export type { Blickfeld } from '../../haushalt';

type PreisZeile = { avg_price?: unknown; fetched_at?: string | Date | null } | null | undefined;

/** `string | number`, weil die Einstellung als Text aus der Datenbank kommt;
 * das `parseInt(String(…))` der Rechner ist deshalb tragend. */
type Stunden = string | number;

/** DIE Zustandsauflösung für ein Set — eine, weil mehrere eigene Fassungen
 * auseinandergelaufen waren. */
export async function resolveSetCondition(
  k: FinanzenKontext,
  uid: number | number[],
  setNumber: string,
  dbh?: Pick<DbSchnittstelle, 'get'>,
): Promise<'N' | 'U'> {
  // Blickfeld statt nackter ID: Das Set gehört oft einem Unterkonto. `dbh`:
  // Wer in einer Transaktion fragt, liest auch darin (priceForNewAcquisition).
  const row = await k.preisCache.setZustandsZaehler(asIds(uid), setNumber, dbh);
  return effectiveCondition(row);
}

// 'U', weil der Gebrauchtpreis dem Wiederverkaufswert der Sammlung entspricht;
// der andere Zustand dient als Rückfall.
export const DEFAULT_PRICE_CONDITION = 'U';

/** Kürzer als das TTL-Fenster, damit ein Rückfall (sold → stock) überhaupt
 * wieder angefragt wird. */
const ZERO_PRICE_TTL_HOURS = 6;

/** Die eine Stelle, die „frisch" festlegt. */
export function leerePreisCache(k: FinanzenKontext): Promise<void> {
  return k.preisCache.loescheAlleSetPreise();
}

export async function preisAusCache(
  k: FinanzenKontext,
  setNumber: string,
  condition: string,
  currency: string,
  ttlStunden: number,
) {
  return k.preisCache.setPreisFrisch(setNumber, condition, currency, ttlStunden);
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

interface PreisFuehrer {
  min_price?: unknown;
  avg_price?: unknown;
  max_price?: unknown;
  qty_avg_price?: unknown;
  total_quantity?: unknown;
}

/** Erst Cache, dann (nur mit Preis) Verlaufspunkt. @returns die gelesenen Zahlen */
export async function speicherePreis(
  k: FinanzenKontext,
  setNumber: string,
  condition: string,
  currency: string,
  g: PreisFuehrer | null | undefined,
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
    await t.preisCache.merkeSetPreis(setNumber, condition, currency, preis);
    // Dieselbe Regel wie der Tages-Schnappschuss des Jobs: Ein Verlauf mit zwei
    // Aufnahmeregeln hätte Lücken.
    if (hatPreis({ avg_price: avg, qty_avg_price: qavg }))
      await t.preisCache.merkeSetVerlauf(setNumber, condition, currency, preis);
  });
  return preis;
}

export interface PreisDaten {
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
type CacheZeile = {
  min_price?: unknown;
  avg_price?: unknown;
  max_price?: unknown;
  qty_avg_price?: unknown;
  fetched_at?: string | Date | null;
};
const OHNE_PREIS = { min_price: 0, avg_price: 0, max_price: 0, qty_avg_price: 0 } as const;
const zahlAus = (v: unknown) => Number(v) || 0;
/** avg_price trägt den Marktpreis: Alle Verbraucher lesen es, eine 0 erschiene als „0.00“. */
const ausZeile = (z: CacheZeile, zusatz: Partial<PreisDaten> = {}): PreisDaten => ({
  min_price: zahlAus(z.min_price),
  avg_price: marktpreisAus(z) ?? 0,
  max_price: zahlAus(z.max_price),
  qty_avg_price: zahlAus(z.qty_avg_price),
  from_cache: true,
  ...zusatz,
});

/** Was Set, Teil und Figur unterscheidet; den Ablauf teilen sich alle drei. */
interface Preisquelle {
  name: string;
  lies(zustand: string): Promise<CacheZeile | null | undefined> | CacheZeile | null | undefined;
  frage(zustand: string): Promise<PreisFuehrer | null | undefined>;
  merke(zustand: string, g: PreisFuehrer | null | undefined): Promise<CacheZeile>;
}

/** null: Der Abruf scheiterte; ob das ein Fehler ist, entscheidet der Ablauf. */
async function rufeAb(q: Preisquelle, zustand: string): Promise<CacheZeile | null> {
  try {
    return await q.merke(zustand, await q.frage(zustand));
  } catch (e) {
    console.log(`  ${q.name} cond=${zustand} error: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    return null;
  }
}

/** „Kein Preis“ ist eine Antwort (no_price); scheitert jeder Abruf ohne frische Antwort im
 * Cache, ist das ein Fehler, damit die Merkliste „nicht geladen“ statt „keiner“ zeigt. */
async function holePreisMitRueckfall(
  k: FinanzenKontext,
  q: Preisquelle,
  zustand: string,
  ttl: number,
): Promise<PreisDaten> {
  const anderer = zustand === 'N' ? 'U' : 'N';
  const z = await q.lies(zustand);
  if (hatPreis(z)) return ausZeile(z!);
  const bekanntLeer = cacheUsable(z, ttl);
  let pd: CacheZeile | null = null;
  if (!bekanntLeer) {
    if (!(await k.katalog.kontingentFrei('bricklink')).allowed) fachfehler('zu_viele', 'bricklink_tageslimit');
    pd = await rufeAb(q, zustand);
    if (hatPreis(pd)) return ausZeile(pd!, { from_cache: false, condition_used: zustand });
  }
  const zf = await q.lies(anderer);
  if (hatPreis(zf)) return ausZeile(zf!, { condition_used: anderer, is_fallback: true });
  if (bekanntLeer && cacheUsable(zf, ttl)) return { ...OHNE_PREIS, from_cache: true, no_price: true };
  const frei = (await k.katalog.kontingentFrei('bricklink')).allowed;
  const pd2 = frei ? await rufeAb(q, anderer) : null;
  if (hatPreis(pd2)) return ausZeile(pd2!, { from_cache: false, condition_used: anderer, is_fallback: true });
  if (bekanntLeer || pd || pd2) return { ...OHNE_PREIS, from_cache: !pd && !pd2, no_price: true };
  return frei ? fachfehler('nicht_gefunden', 'kein_bricklink_preis') : fachfehler('zu_viele', 'bricklink_tageslimit');
}

/** Beim Erfassen heisst ein gescheiterter Abruf „keiner“; das erschöpfte Kontingent bleibt ein Fehler. */
export async function preisOderKeiner(abruf: Promise<PreisDaten>): Promise<PreisDaten | null> {
  try {
    return await abruf;
  } catch (e) {
    if (e instanceof Fachfehler && e.code === 'kein_bricklink_preis') return null;
    throw e;
  }
}

const stunden = (ttlHours: Stunden) => Math.max(1, parseInt(String(ttlHours), 10));

export async function fetchPrice(
  k: FinanzenKontext,
  setNumber: string,
  condition: string,
  guideType: string,
  currency: string,
  ttlHours: Stunden,
  pre: { catalog: Map<string, KatalogEintrag>; cache: Map<string, SetPreiszeile> } | null = null,
): Promise<PreisDaten> {
  // mitVersion() auch beim vorgeladenen Weg: Die Karte kommt aus catalog_cache,
  // also unter derselben Schreibweise wie die Tabelle.
  const catalogRow = pre?.catalog
    ? pre.catalog.get(mitVersion(setNumber)) || null
    : await k.katalog.katalogEintrag(setNumber);
  if (ohneBricklinkPreis(catalogRow)) return { ...OHNE_PREIS, from_cache: true, no_price: true, bl_unbekannt: true };
  const ttl = stunden(ttlHours);
  const quelle: Preisquelle = {
    name: `Price ${setNumber}`,
    lies: c =>
      pre?.cache ? pre.cache.get(`${setNumber}|${c}`) || null : preisAusCache(k, setNumber, c, currency, ttl),
    frage: c => k.katalog.getPriceGuide(setNumber, c, guideType, currency),
    merke: async (c, g) => {
      const p = await speicherePreis(k, setNumber, c, currency, g);
      console.log(`  Price ${setNumber} cond=${c}: avg=${p.avg} qty_avg=${p.qavg}`);
      return { min_price: p.min, avg_price: p.avg, max_price: p.max, qty_avg_price: p.qavg };
    },
  };
  return holePreisMitRueckfall(k, quelle, condition, ttl);
}

/** Nur der Cache: Eine Liste soll nicht auf BrickLink warten. Rückfall auf den anderen
 * Zustand; sind beide frisch leer, gibt es keinen Preis, fehlt einer, steht er aus. */
export function preisAusVorrat(
  lies: (zustand: 'N' | 'U') => CacheZeile | null | undefined,
  zustand: 'N' | 'U',
  ttlStunden: number,
): PreisDaten {
  const anderer = zustand === 'N' ? 'U' : 'N';
  const z = lies(zustand) ?? null;
  if (hatPreis(z)) return ausZeile(z!);
  const zf = lies(anderer) ?? null;
  if (hatPreis(zf)) return ausZeile(zf!, { condition_used: anderer, is_fallback: true });
  if (cacheUsable(z, ttlStunden) && cacheUsable(zf, ttlStunden))
    return { ...OHNE_PREIS, from_cache: true, no_price: true };
  return { ...OHNE_PREIS, from_cache: false, ausstehend: true };
}

export function setPreisAusVorrat(
  setNumber: string,
  zustand: 'N' | 'U',
  ttlStunden: number,
  pre: { catalog: Map<string, unknown>; cache: Map<string, CacheZeile> },
): PreisDaten {
  if (ohneBricklinkPreis((pre.catalog.get(mitVersion(setNumber)) as Parameters<typeof ohneBricklinkPreis>[0]) ?? null))
    return { ...OHNE_PREIS, from_cache: true, no_price: true, bl_unbekannt: true };
  return preisAusVorrat(c => pre.cache.get(`${setNumber}|${c}`), zustand, ttlStunden);
}

export async function teilSchluessel(k: FinanzenKontext, partNumber: string, rbColorId: number): Promise<string> {
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
    if (wert == null) {
      karte.delete(schluessel);
      return null;
    }
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
export async function farbkarte(k: FinanzenKontext): Promise<Map<number, number>> {
  const st = k.faecher.fach<Farbstand>('farbkarte', () => ({ karte: null, zeit: 0, ladung: null }));
  const jetzt = Date.now();
  if (st.karte && jetzt - st.zeit < NACHSCHLAG_TTL_MS) return st.karte;
  if (st.ladung) return st.ladung;
  st.ladung = (async () => {
    const rows = await k.preisCache.blFarben();
    const karte = new Map<number, number>();
    for (const r of rows) karte.set(Number(r.id), r.bl_color_id);
    // Eine LEERE Tabelle wird NICHT gemerkt: Vor dem ersten Abgleich ist sie leer,
    // und zehn Minuten jede Übersetzung zu verweigern hiesse, den Abgleich zu ignorieren.
    if (karte.size) Object.assign(st, { karte, zeit: jetzt });
    return karte;
  })();
  try {
    return await st.ladung;
  } finally {
    st.ladung = null;
  }
}

/** KEINE_FARBE ist bei BrickLink 0, Rebrickables 0 ist Schwarz. @returns null, wenn die Karte
 * nicht lesbar ist: Mit der Rebrickable-Farbe käme der Preis eines anderen Teils. */
export async function resolveBlColorId(k: FinanzenKontext, rbColorId: number): Promise<number | null> {
  if (rbColorId == null || rbColorId === KEINE_FARBE) return 0;
  const karte = await versuche('preise:farbkarte', farbkarte(k));
  if (!karte.ok) return null;
  const treffer = karte.wert.get(Number(rbColorId));
  return treffer != null ? Number(treffer) : rbColorId;
}

// Ohne Übersetzung antwortet BrickLink für RB-Nummern mit 404. Eine Quelle
// (bl_zuordnung), damit nicht zwei Orte auseinanderlaufen. Je Satz Dienste ein Gedächtnis.
const blTeil = (k: FinanzenKontext) =>
  k.faecher.fach('blTeil', () => nachschlagwerk((partNumber: string) => k.katalog.blAbrufNummer('part', partNumber)));

/** Mit `konto` zuerst dessen eigene Zuordnung (Migration 0094); sie geht am
 * gemeinsamen Gedächtnis vorbei, weil sie nur für dieses Konto gilt. */
export async function resolveBlPartNumber(k: FinanzenKontext, partNumber: string, konto: number | null = null) {
  // Ohne Fang: Mit der Rebrickable-Nummer käme der Preis eines anderen Teils.
  if (konto !== null) return (await k.katalog.blAbrufNummer('part', partNumber, konto)) ?? partNumber;
  return (await blTeil(k)(partNumber)) ?? partNumber;
}

/** In zwei Abfragen, weil das Gedächtnis innerhalb einer Bewertung nicht hilft:
 * Jedes Teil hat eine andere Nummer. */
export async function ladeBlNummernVor(k: FinanzenKontext, teilnummern: string[]): Promise<void> {
  const offen = [...new Set(teilnummern.filter(Boolean).map(String))].filter(n => !blTeil(k).kennt(n));
  if (!offen.length) return;
  // Die Abfrage steht in src/katalog/blZuordnung.ts.
  for (const [rb, bl] of await k.katalog.blAbrufNummern('part', offen)) blTeil(k).merken(rb, bl);
}

/** Sonst fragte jedes Teil je Zustand einzeln. Schlüssel wie in fetchPartPrice:
 * BrickLink-Nummer|BrickLink-Farbe|Zustand. */
export async function ladeTeilepreiseVor(
  k: FinanzenKontext,
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
  const zeilen = await k.preisCache.teilepreiseFrisch(nummern, farben, currency, ttl);
  for (const z of zeilen) vorrat.set(`${z.part_number}|${z.color_id}|${z.condition}`, z);
  return vorrat;
}

/** Wie ladeTeilepreiseVor, für Figuren — nur echte BrickLink-Preise. */
export async function ladeFigurenpreiseVor(
  k: FinanzenKontext,
  figuren: string[],
  currency: string,
  ttlHours: Stunden,
): Promise<Map<string, Preiszeile>> {
  const ttl = Math.max(1, parseInt(String(ttlHours), 10));
  const vorrat = new Map<string, Preiszeile>();
  if (!figuren.length) return vorrat;
  const zeilen = await k.preisCache.figurenpreiseFrisch([...new Set(figuren)], currency, ttl);
  for (const z of zeilen) vorrat.set(`${z.fig_number}|${z.condition}`, z);
  return vorrat;
}

/** Erst Verkäufe, sonst Angebote: Bei Teilen in seltenen Farben ist „kein Verkauf
 * in sechs Monaten“ der Normalfall. */
async function fragePreisfuehrer(
  k: FinanzenKontext,
  pfad: string,
  zustand: string,
  currency: string,
  extra: Record<string, string> = {},
) {
  const qp = { guide_type: 'sold', new_or_used: zustand, currency_code: currency, vat: 'N', ...extra };
  const g = await k.katalog.quellen.bricklinkRequest('GET', pfad, qp);
  if (hatPreis(g)) return g;
  const alt = await versuche(
    'preise:alt',
    k.katalog.quellen.bricklinkRequest('GET', pfad, { ...qp, guide_type: 'stock' }),
  );
  return alt.ok && hatPreis(alt.wert) ? alt.wert : g;
}

type Schreiber = (avg: number, qavg: number) => Promise<unknown>;

/** Auch eine Null wird gemerkt (hält den Abruf zurück); ein Nullpunkt im Verlauf sähe aus wie ein Kurssturz. */
async function merkeMitVerlauf(g: PreisFuehrer | null | undefined, ort: string, cache: Schreiber, verlauf: Schreiber) {
  const zeile = { avg_price: zahlAus(g?.avg_price), qty_avg_price: zahlAus(g?.qty_avg_price) };
  await cache(zeile.avg_price, zeile.qty_avg_price);
  if (hatPreis(zeile)) await verlauf(zeile.avg_price, zeile.qty_avg_price).catch(logAndContinue(ort));
  return zeile;
}

/** Nummer und Farbe übersetzt für Cache, Abruf und Schreiben, sonst passten sie nicht zueinander.
 * @param vorrat aus ladeTeilepreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
export async function fetchPartPrice(
  k: FinanzenKontext,
  partNumber: string,
  rbColorId: number,
  condition: string,
  currency: string,
  ttlHours: Stunden,
  vorrat: Map<string, Preiszeile> | null = null,
  konto: number | null = null,
): Promise<PreisDaten> {
  const farbe = await resolveBlColorId(k, rbColorId);
  if (farbe === null) fachfehler('nicht_gefunden', 'kein_bricklink_preis');
  const nummer = await resolveBlPartNumber(k, partNumber, konto);
  const f = Number(farbe) || 0;
  const ttl = stunden(ttlHours);
  const cache = k.preisCache;
  const quelle: Preisquelle = {
    name: `Part price ${partNumber}${nummer !== partNumber ? ` (bl ${nummer})` : ''} color ${farbe} (rb color ${rbColorId})`,
    lies: c =>
      vorrat ? (vorrat.get(`${nummer}|${f}|${c}`) ?? null) : cache.teilpreisFrisch(nummer, f, c, currency, ttl),
    frage: c =>
      fragePreisfuehrer(k, `/items/part/${nummer}/price`, c, currency, farbe ? { color_id: String(farbe) } : {}),
    merke: (c, g) =>
      merkeMitVerlauf(
        g,
        'preise:teileverlauf schreiben',
        (avg, qavg) => cache.merkeTeilpreis(nummer, f, c, currency, avg, qavg),
        (avg, qavg) => cache.merkeTeilVerlauf(nummer, f, c, currency, avg, qavg),
      ),
  };
  return holePreisMitRueckfall(k, quelle, condition, ttl);
}

/** Wie fetchPartPrice; gelesen werden nur echte BrickLink-Preise, keine Schätzungen.
 * @param vorrat aus ladeFigurenpreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
export async function fetchMinifigPrice(
  k: FinanzenKontext,
  figNumber: string,
  condition: string,
  currency: string,
  ttlHours: Stunden,
  vorrat: Map<string, Preiszeile> | null = null,
): Promise<PreisDaten> {
  const ttl = stunden(ttlHours);
  const cache = k.preisCache;
  const quelle: Preisquelle = {
    name: `Minifig price ${figNumber}`,
    lies: c =>
      vorrat ? (vorrat.get(`${figNumber}|${c}`) ?? null) : cache.figurpreisFrisch(figNumber, c, currency, ttl),
    frage: c => fragePreisfuehrer(k, `/items/minifig/${figNumber}/price`, c, currency),
    merke: (c, g) =>
      merkeMitVerlauf(
        g,
        'preise:figurverlauf schreiben',
        (avg, qavg) => cache.merkeFigurpreis(figNumber, c, currency, avg, qavg),
        (avg, qavg) => cache.merkeFigurVerlauf(figNumber, c, currency, avg, qavg),
      ),
  };
  return holePreisMitRueckfall(k, quelle, condition, ttl);
}
