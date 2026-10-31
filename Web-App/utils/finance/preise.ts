/**
 * Die PREISSCHICHT des Finanzteils: BrickLink abfragen, Antworten
 * zwischenspeichern, das taegliche Anfragekontingent verwalten und
 * BrickLink-Nummern aufloesen.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#abschnitt
 */

import * as db from '../../db/database';
import { hatPreis } from '../preisRegel';
import { asIds } from '../../src/haushalt/haushalt';
import { checkAndIncrementRateLimit, kontingentFrei, getLimitForApi, getRateLimitStatus } from '../apiKontingent';
import { bricklinkRequest, getPriceGuide } from '../../clients/bricklink';
import { fehlertext, logAndContinue, meldeUndLiefere } from '../../src/infra/httpError';
import { mitVersion, katalogEintrag, ohneBricklinkPreis } from '../../src/sets/setNummer';
import { effectiveCondition } from './zustand';
import { blAbrufNummer, blAbrufNummern } from '../blZuordnung';
import { KEINE_FARBE } from '../../src/infra/validate';



/**
 * Die drei Fremd-Schnittstellen, deren Tagesbudget hier gezaehlt wird.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#apiname
 */

/**
 * Blickfeld: wessen DATEN gerechnet werden. Getrennt von `viewerId`, wessen
 * EINSTELLUNGEN gelten — die beiden fallen auseinander, sobald der Kontofilter
 * auf „Unterkonten" steht (siehe computeSetsValuation).
 */
export type { Blickfeld } from '../../src/haushalt/haushalt';

/** Eine Preis-Cache-Zeile, soweit hier gelesen. */
type PreisZeile = { avg_price?: number | string | null; fetched_at?: string | Date | null } | null | undefined;

/**
 * Cache-Dauer in Stunden — `string | number`, und das ist NACHGEMESSEN:
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#stunden
 */
type Stunden = string | number;

/**
 * DIE Zustandsauflösung für ein einzelnes Set — per Datenbankabfrage, für
 * Aufrufer ohne bereits geladene acq_count/used_count-Felder.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#resolvesetcondition
 */
async function resolveSetCondition(
  uid: number | number[], setNumber: string, dbh: { get: typeof db.get } = db,
): Promise<'N' | 'U'> {
  // Blickfeld statt nackter ID: Das Set gehört oft einem Unterkonto. `dbh`:
  // Wer in einer Transaktion fragt, liest auch darin (priceForNewAcquisition).
  const uids = asIds(uid as any);
  const row = await dbh.get(
    // Ohne s.condition (Migration 0032): Der Zustand steht in den Erfassungen,
    // und effectiveCondition() liest ohnehin nur noch die beiden Zaehler.
    `SELECT COUNT(a.id)                                 AS acq_count,
            COUNT(a.id) FILTER (WHERE a.condition='U')  AS used_count
       FROM sets s LEFT JOIN set_acquisitions a
         ON a.user_id = s.user_id AND a.set_number = s.set_number
      WHERE s.user_id = ANY($1) AND s.set_number=$2`,
    [uids, setNumber]
  ).catch(meldeUndLiefere('preise:row', null));
  return effectiveCondition(row);
}


// Vorgabezustand der Preisabfragen; der andere dient als Rückfall. 'U', weil
// der Gebrauchtpreis dem Wiederverkaufswert der Sammlung entspricht.
const DEFAULT_PRICE_CONDITION = 'U';

const PRICE_CACHE_COLS = 'set_number, condition, min_price, avg_price, max_price, qty_avg_price, fetched_at';

/**
 * Wie lange ein Eintrag OHNE Preis (avg_price = 0) als endgültig gilt.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#zero-price-ttl-hours
 */
const ZERO_PRICE_TTL_HOURS = 6;

/** Die Preiszeile aus dem Cache, sofern sie jung genug ist — die eine Stelle, die „frisch“ festlegt. */
async function preisAusCache(setNumber: string, condition: string, currency: string, ttlStunden: number) {
  return db.get(
    `SELECT ${PRICE_CACHE_COLS} FROM price_cache
      WHERE set_number = $1 AND condition = $2 AND currency_code = $3
        AND fetched_at > NOW() - make_interval(hours => $4)`,
    [setNumber, condition, currency, ttlStunden]);
}

/** Ist der Cache-Eintrag brauchbar, oder soll neu geholt werden? */
function cacheUsable(row: PreisZeile, ttlHours: number) {
  if (!row) return false;
  // parseFloat(String(...)): avg_price ist eine numeric-Spalte, und der
  // pg-Treiber gibt numeric als Zeichenkette zurueck. Der Typ macht das
  // sichtbar, statt es der JS-Umwandlung zu ueberlassen.
  if (hatPreis(row)) return true;
  // 0-Eintrag: nur kurz vertrauen, danach neu versuchen.
  if (!row.fetched_at) return false;
  const ageH = (Date.now() - new Date(row.fetched_at).getTime()) / 3600000;
  return ageH < Math.min(ZERO_PRICE_TTL_HOURS, ttlHours);
}

/** Rohantwort des BrickLink-Preisfuehrers — alle Felder kommen als Text. */
interface PreisFuehrer { min_price?: unknown; avg_price?: unknown; max_price?: unknown; qty_avg_price?: unknown; total_quantity?: unknown; }

/**
 * Eine BrickLink-Antwort wegschreiben: erst in den Cache, dann — nur wenn ein
 * Preis drinsteht — als Punkt in den Verlauf.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#speicherepreis
 * @returns die gelesenen Zahlen, damit der Aufrufer nicht erneut umwandeln muss
 */
async function speicherePreis(setNumber: string, condition: string, currency: string, g: PreisFuehrer | null | undefined) {
  const min  = parseFloat(String(g?.min_price     ?? 0)) || 0;
  const avg  = parseFloat(String(g?.avg_price     ?? 0)) || 0;
  const max  = parseFloat(String(g?.max_price     ?? 0)) || 0;
  const qavg = parseFloat(String(g?.qty_avg_price ?? 0)) || 0;
  const qty  = parseInt(String(g?.total_quantity  ?? 0)) || 0;

  // Auch eine Null-Antwort wird geschrieben. Sie ist die Auskunft „BrickLink
  // kennt hier keinen Preis" und haelt den naechsten Abruf zurueck; wie lange,
  // entscheidet cacheUsable().
  await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET min_price=$4,avg_price=$5,max_price=$6,qty_avg_price=$7,total_quantity=$8,fetched_at=NOW()`,
    [setNumber, condition, currency, min, avg, max, qavg, qty]);

  // In den Verlauf nur, was auch ein Punkt in der Kurve waere. Die Bedingung
  // ist weiter als hatPreis() — absichtlich: Der Tages-Schnappschuss am Ende
  // des Jobs nimmt dieselbe (avg > 0 OR qty_avg > 0), und ein Verlauf mit zwei
  // Aufnahmeregeln haette Luecken, je nachdem wer geschrieben hat.
  if (avg > 0 || qavg > 0) {
    await db.run(
      'INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [setNumber, condition, currency, avg, qavg, min, max]).catch(logAndContinue('preise:setverlauf schreiben'));
  }
  return { min, avg, max, qavg, qty };
}

async function fetchPrice(setNumber: string, condition: string, guideType: string, currency: string, ttlHours: Stunden, pre: { catalog: Map<any, any>; cache: Map<string, any> } | null = null) {
  // mitVersion() auch beim VORGELADENEN Weg: Die Karte wird unten aus
  // catalog_cache gefuellt, also unter derselben Schreibweise wie die Tabelle.
  const catalogRow = pre?.catalog
    ? (pre.catalog.get(mitVersion(setNumber)) || null)
    : await katalogEintrag(setNumber);
  if (ohneBricklinkPreis(catalogRow))
    return { min_price:0, avg_price:0, max_price:0, qty_avg_price:0, from_cache:true, no_price:true, bl_unbekannt:true };

  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const cached = pre?.cache
    ? (pre.cache.get(`${setNumber}|${condition}`) || null)
    : await preisAusCache(setNumber, condition, currency, ttl);
  if (hatPreis(cached))
    return { min_price: cached.min_price, avg_price: cached.avg_price, max_price: cached.max_price, qty_avg_price: cached.qty_avg_price, from_cache: true };

  // 0-Eintrag, der noch frisch genug ist: erst den anderen Zustand aus dem
  // Cache versuchen, sonst als preislos melden. Ist er älter, fällt er durch
  // und unten wird neu geholt — dort greift dann der sold→stock-Rückfall.
  if (cached && !hatPreis(cached) && cacheUsable(cached, ttl)) {
    const cachedFb = pre?.cache
      ? (pre.cache.get(`${setNumber}|${fallbackCondition}`) || null)
      : await preisAusCache(setNumber, fallbackCondition, currency, ttl);
    // Vorher stand hier `avg > 0 || avg > 0` — derselbe Ausdruck zweimal.
    // Gemeint war ersichtlich qty_avg; richtig ist aber die eine Regel, die
    // auch der Leser anwendet (utils/preisRegel.ts).
    if (hatPreis(cachedFb))
      return { min_price: cachedFb.min_price, avg_price: cachedFb.avg_price, max_price: cachedFb.max_price, qty_avg_price: cachedFb.qty_avg_price, from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    // Nur wenn auch der andere Zustand frisch geprüft ist, gilt das Set als
    // preislos. Sonst wird er geholt: Ein älterer Preis dafür liegt oft vor
    // (die Detailansicht zeigt ihn), und ohne Abruf bliebe Finanzen leer.
    if (!cacheUsable(cachedFb, ttl)) {
      const rl = await kontingentFrei('bricklink');
      const fb = rl.allowed ? await tryFetch(fallbackCondition) : null;
      if (hatPreis(fb)) return { ...fb, condition_used: fallbackCondition, is_fallback: true };
    }
    return { min_price:0, avg_price:0, max_price:0, qty_avg_price:0, from_cache:true, no_price:true };
  }

  async function tryFetch(cond: string) {
    try {
      // Lazy-Require: Top-Level würde einen Require-Zyklus utils ↔ routes
      // erzeugen (bricklink.js nutzt den Rate-Limiter von hier).
      const g = await getPriceGuide(setNumber, cond, guideType, currency);
      const { min, avg, max, qavg } = await speicherePreis(setNumber, cond, currency, g);
      console.log(`  Price ${setNumber} cond=${cond}: avg=${avg} qty_avg=${qavg}`);
      return { min_price:min, avg_price:avg, max_price:max, qty_avg_price:qavg, from_cache:false };
    } catch (e) { console.log(`  Price ${setNumber} cond=${cond} error: ${fehlertext(e)}`); return null; }
  }

  const rl1 = await kontingentFrei('bricklink');
  if (!rl1.allowed) throw new Error(`BrickLink Tageslimit erreicht (${rl1.limit} Aufrufe/Tag)`);

  const pd = await tryFetch(condition);
  // Preis-Vorhandensein an avg_price festmachen — das ist der Wert, den alle
  // Verbraucher lesen. Vorher genügte ein qty_avg_price > 0, womit ein Datensatz
  // mit avg_price = 0 als "hat einen Preis" durchging und überall 0 ergab.
  if (hatPreis(pd)) return { ...pd, condition_used: condition };

  const cachedFallback = await preisAusCache(setNumber, fallbackCondition, currency, ttl);
  if (hatPreis(cachedFallback))
    return { min_price: cachedFallback.min_price, avg_price: cachedFallback.avg_price, max_price: cachedFallback.max_price, qty_avg_price: cachedFallback.qty_avg_price, from_cache: true, condition_used: fallbackCondition, is_fallback: true };

  const rl2 = await kontingentFrei('bricklink');
  if (!rl2.allowed) { if (pd) return { ...pd, condition_used: condition }; throw new Error('BrickLink Tageslimit erreicht'); }

  const pd2 = await tryFetch(fallbackCondition);
  if (hatPreis(pd2)) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd) return { ...pd, condition_used: condition };
  throw new Error(`${setNumber} — kein BrickLink-Preis gefunden`);
}

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results = new Array(tasks.length); let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; const t = tasks[i]; if (t) results[i] = await t(); } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}


// Nachschlagewerk — zwei Übersetzungstabellen, die sich während einer
// Bewertung nicht ändern
// Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#nachschlag-ttl-ms
const NACHSCHLAG_TTL_MS = 10 * 60 * 1000;
// Deckel gegen unbegrenztes Wachstum: Beim Überschreiten wird geleert statt
// einzeln aufgeräumt — dieselbe Entscheidung wie bei _tokenCache in
// src/konto/auth.ts, aus demselben Grund (eine Handvoll Nutzer, kleine Tabellen).
const NACHSCHLAG_MAX = 5000;

/** Gemerkte Fassung von `hole`; ein `null` (nichts gefunden) wird nicht gemerkt. */
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
  // Kein Leeren: Die Quelltabellen werden nur ergänzt, ein Treffer bleibt
  // richtig. kennt()/merken() erlauben das Vorladen vieler Antworten (ladeBlNummernVor).
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

/**
 * Die Farbtabelle als GANZES merken, nicht Zeile für Zeile.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#farbkarte
 */
let _farbkarte: { karte: Map<number, any>; zeit: number } | null = null;
// Der Ladevorgang wird geteilt, nicht nur sein Ergebnis: Fünf parallele
// Bewerter träfen den kalten Speicher sonst gleichzeitig und lüden je selbst.
let _farbladung: Promise<Map<number, any>> | null = null;
/** Die Farbzuordnung Rebrickable → BrickLink als Map, für Bewertung und Teileliste. */
async function farbkarte(): Promise<Map<number, any>> {
  const jetzt = Date.now();
  if (_farbkarte && jetzt - _farbkarte.zeit < NACHSCHLAG_TTL_MS) return _farbkarte.karte;
  if (_farbladung) return _farbladung;
  _farbladung = (async () => {
    const rows = await db.all('SELECT id, bl_color_id FROM rb_colors WHERE bl_color_id IS NOT NULL');
    const karte = new Map<number, any>();
    for (const r of rows) karte.set(Number(r.id), r.bl_color_id);
    // Eine LEERE Tabelle wird NICHT gemerkt: Vor dem ersten Rebrickable-Abgleich
    // ist sie leer, und zehn Minuten lang jede Übersetzung zu verweigern hiesse,
    // dem Abgleich beim Nachfüllen zuzusehen und ihn zu ignorieren.
    if (karte.size) _farbkarte = { karte, zeit: jetzt };
    return karte;
  })();
  try { return await _farbladung; }
  finally { _farbladung = null; }
}

/**
 * Rebrickable-Farbe → BrickLink-Farbe. KEINE_FARBE ist bei BrickLink 0
 * („(Not Applicable)“); Rebrickables 0 ist Schwarz und geht über die Karte.
 */
async function resolveBlColorId(rbColorId: number) {
  if (rbColorId == null || rbColorId === KEINE_FARBE) return 0;
  try {
    const treffer = (await farbkarte()).get(Number(rbColorId));
    return treffer != null ? treffer : rbColorId;
  } catch (_) { return rbColorId; }
}

// Rebrickable-Teilenummer → BrickLink-Teilenummer (bl_zuordnung, gepflegt
// durch fetchMissingBlIds nach dem CSV-Sync). Ohne diese Übersetzung antwortet
// BrickLink für RB-Nummern mit 404 RESOURCE_NOT_FOUND — analog zu
// resolveBlColorId für die Farben. Unbekannte Nummern (oder bereits …
// Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#blteil
const _blTeil = nachschlagwerk(async (partNumber: string) => {
  return await blAbrufNummer('part', partNumber);
});

async function resolveBlPartNumber(partNumber: string) {
  try {
    return (await _blTeil(partNumber)) ?? partNumber;
  } catch (_) { return partNumber; }
}

/**
 * Die BrickLink-Nummern EINER Bewertung in zwei Abfragen vorladen.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#ladeblnummernvor
 */
async function ladeBlNummernVor(teilnummern: string[]): Promise<void> {
  const offen = [...new Set(teilnummern.filter(Boolean).map(String))].filter(n => !_blTeil.kennt(n));
  if (!offen.length) return;
  // EINE Abfrage, nicht zwei: Der Rückfall über `parts.bl_part_number` ist mit
  // Migration 0037 weg (siehe die Begründung bei _blTeil). Die Abfrage selbst
  // steht in utils/blZuordnung.ts.
  for (const [rb, bl] of await blAbrufNummern('part', offen)) _blTeil.merken(rb, bl);
}

/**
 * Die frischen Cachezeilen vieler Teile in EINER Abfrage. Die Bewertung reicht
 * sie an fetchPartPrice weiter; sonst fragte jedes Teil je Zustand einzeln.
 * Schlüssel wie in fetchPartPrice: BrickLink-Nummer|BrickLink-Farbe|Zustand.
 */
async function ladeTeilepreiseVor(teile: { partNumber: string; rbColorId: number }[],
                                  currency: string, ttlHours: Stunden): Promise<Map<string, any>> {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const nummern: string[] = [], farben: number[] = [];
  for (const t of teile) {
    nummern.push(await resolveBlPartNumber(t.partNumber));
    farben.push(Number(await resolveBlColorId(t.rbColorId)) || 0);
  }
  const vorrat = new Map<string, any>();
  if (!nummern.length) return vorrat;
  const zeilen = await db.all(
    `SELECT c.part_number, c.color_id, c.condition, c.avg_price, c.qty_avg_price
       FROM part_price_cache c
       JOIN unnest($1::text[], $2::int[]) AS k(nr, farbe)
         ON c.part_number = k.nr AND c.color_id = k.farbe
      WHERE c.currency_code = $3 AND c.fetched_at > NOW() - make_interval(hours => $4)`,
    [nummern, farben, currency, ttl]);
  for (const z of zeilen) vorrat.set(`${z.part_number}|${z.color_id}|${z.condition}`, z);
  return vorrat;
}

/** Wie ladeTeilepreiseVor, für Figuren — nur echte BrickLink-Preise. */
async function ladeFigurenpreiseVor(figuren: string[], currency: string, ttlHours: Stunden): Promise<Map<string, any>> {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const vorrat = new Map<string, any>();
  if (!figuren.length) return vorrat;
  const zeilen = await db.all(
    `SELECT fig_number, condition, avg_price, qty_avg_price FROM minifig_price_cache
      WHERE fig_number = ANY($1) AND currency_code = $2 AND NOT geschaetzt
        AND fetched_at > NOW() - make_interval(hours => $3)`,
    [[...new Set(figuren)], currency, ttl]);
  for (const z of zeilen) vorrat.set(`${z.fig_number}|${z.condition}`, z);
  return vorrat;
}

/**
 * Teilepreis bei BrickLink, mit Rückfall auf den anderen Zustand (viele ältere
 * Teile gibt es nur gebraucht). Nummer und Farbe werden zuerst auf BrickLink
 * übersetzt und dann für Cache, Abruf und Schreiben benutzt.
 * Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#fetchpartprice
 * @param vorrat aus ladeTeilepreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
async function fetchPartPrice(partNumber: string, rbColorId: number, condition: string, currency: string, ttlHours: Stunden,
                              vorrat: Map<string, any> | null = null) {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const colorId = await resolveBlColorId(rbColorId);
  const blPartNumber = await resolveBlPartNumber(partNumber);
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const readCache = async (cond: string) => vorrat
    ? (vorrat.get(`${blPartNumber}|${Number(colorId) || 0}|${cond}`) ?? null)
    : db.get(
      `SELECT avg_price, qty_avg_price FROM part_price_cache WHERE part_number=$1 AND color_id=$2 AND condition=$3 AND currency_code=$4 AND fetched_at > NOW() - make_interval(hours => $5)`,
      [blPartNumber, colorId, cond, currency, ttl]);

  // Frischer Cache-Treffer mit echtem Preis → fertig
  const cached = await readCache(condition);
  if (hatPreis(cached))
    return { avg_price: parseFloat(cached.avg_price), qty_avg_price: parseFloat(cached.qty_avg_price), from_cache: true };

  // Frische 0 gecacht: Fallback-Zustand aus dem Cache probieren. Ist der
  // Fallback ebenfalls frisch gecacht (und 0), gibt es wirklich keinen Preis.
  // Wurde der Fallback aber noch nie geholt, NICHT aufgeben, sondern unten
  // live nachholen — nur den (bekannt leeren) Primärzustand überspringen.
  let skipPrimaryFetch = false;
  if (cached && !hatPreis(cached)) {
    const cachedFb = await readCache(fallbackCondition);
    if (hatPreis(cachedFb))
      // qty_avg_price kam hier aus cachedFb.AVG_price — derselbe Operand
      // zweimal, wie schon bei `avg > 0 || avg > 0`. Beide Funktionen sind
      // voneinander kopiert, der Fehler damit auch. Der Set-Pfad weiter oben
      // macht es richtig.
      return { avg_price: parseFloat(cachedFb.avg_price), qty_avg_price: parseFloat(cachedFb.qty_avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    if (cachedFb) return { avg_price: 0, qty_avg_price: 0, from_cache: true, no_price: true };
    skipPrimaryFetch = true;
  }

  async function tryFetch(cond: string) {
    try {
      const qp: Record<string, any> = { guide_type: 'sold', new_or_used: cond, currency_code: currency, vat: 'N' };
      if (colorId && colorId !== 0) qp.color_id = String(colorId);
      // BrickLink part price: /items/part/{blPartNumber}/price?color_id={colorId}
      let g = await bricklinkRequest('GET', `/items/part/${blPartNumber}/price`, qp);
      // Kein Verkauf in sechs Monaten → aktuelle Angebote heranziehen. Bei
      // einzelnen Teilen in seltenen Farben ist das der Normalfall.
      if (!hatPreis(g)) {
        const alt = await bricklinkRequest('GET', `/items/part/${blPartNumber}/price`,
          { ...qp, guide_type: 'stock' }).catch(meldeUndLiefere('preise:alt', null));
        if (hatPreis(alt)) g = alt;
      }
      const avg  = parseFloat(g?.avg_price || 0);
      const qavg = parseFloat(g?.qty_avg_price || 0);
      await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (part_number,color_id,condition,currency_code)
        DO UPDATE SET avg_price=$5, qty_avg_price=$6, fetched_at=NOW()`,
        [blPartNumber, colorId || 0, cond, currency, avg, qavg]);
      // Verlaufspunkt mitschreiben — nur bei echtem Preis.
      // Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#fetchpartprice-2
      if (avg > 0 || qavg > 0) {
        await db.run(
          `INSERT INTO part_price_history (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [blPartNumber, colorId || 0, cond, currency, avg, qavg]
        ).catch(logAndContinue('preise:teileverlauf schreiben'));
      }
      return { avg_price: avg, qty_avg_price: qavg, from_cache: false };
    } catch (e) {
      console.log(`  Part price failed ${partNumber}${blPartNumber !== partNumber ? ` (bl ${blPartNumber})` : ''} color ${colorId} (rb color ${rbColorId}) cond=${cond}: ${fehlertext(e)}`);
      return null;
    }
  }

  let pd: any = null;
  if (!skipPrimaryFetch) {
    const rl1 = await kontingentFrei('bricklink');
    if (!rl1.allowed) throw new Error('BrickLink Tageslimit erreicht');
    pd = await tryFetch(condition);
    if (hatPreis(pd)) return { ...pd, condition_used: condition };

    const cachedFallback = await readCache(fallbackCondition);
    if (hatPreis(cachedFallback))
      return { avg_price: parseFloat(cachedFallback.avg_price), qty_avg_price: parseFloat(cachedFallback.qty_avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
  }

  const rl2 = await kontingentFrei('bricklink');
  if (!rl2.allowed) {
    if (pd) return { ...pd, condition_used: condition };
    throw new Error('BrickLink Tageslimit erreicht');
  }

  const pd2 = await tryFetch(fallbackCondition);
  if (hatPreis(pd2)) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd2) return { ...pd2, condition_used: fallbackCondition };
  if (pd)  return { ...pd, condition_used: condition };
  // KEINE Nutzermeldung, sondern ein Merkmal des Preisergebnisses: Der
  // Preis-Job zaehlt daran „uebersprungen" statt „Fehler". Es wird nirgends
  // angezeigt und bleibt deshalb bewusst unuebersetzt.
  return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'kein BrickLink-Preis gefunden' };
}

// ── Fetch price for a single minifig from BrickLink ─────────────────────────
// Gleiche Fallback-Logik wie fetchPartPrice: erst der gewünschte Zustand,
// bei leerem Price Guide der jeweils andere ('U' ↔ 'N').
/** @param vorrat aus ladeFigurenpreiseVor; fehlt ein Schlüssel, gibt es keinen frischen Eintrag. */
async function fetchMinifigPrice(figNumber: string, condition: string, currency: string, ttlHours: Stunden,
                                 vorrat: Map<string, any> | null = null) {
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const fallbackCondition = condition === 'N' ? 'U' : 'N';

  const readCache = async (cond: string) => vorrat
    ? (vorrat.get(`${figNumber}|${cond}`) ?? null)
    : db.get(
      `SELECT avg_price, qty_avg_price FROM minifig_price_cache WHERE fig_number=$1 AND condition=$2 AND currency_code=$3 AND NOT geschaetzt AND fetched_at > NOW() - make_interval(hours => $4)`,
      [figNumber, cond, currency, ttl]);

  const cached = await readCache(condition);
  if (hatPreis(cached))
    return { avg_price: parseFloat(cached.avg_price), qty_avg_price: parseFloat(cached.qty_avg_price), from_cache: true };

  let skipPrimaryFetch = false;
  if (cached && !hatPreis(cached)) {
    const cachedFb = await readCache(fallbackCondition);
    if (hatPreis(cachedFb))
      // qty_avg_price kam hier aus cachedFb.AVG_price — derselbe Operand
      // zweimal, wie schon bei `avg > 0 || avg > 0`. Beide Funktionen sind
      // voneinander kopiert, der Fehler damit auch. Der Set-Pfad weiter oben
      // macht es richtig.
      return { avg_price: parseFloat(cachedFb.avg_price), qty_avg_price: parseFloat(cachedFb.qty_avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
    if (cachedFb) return { avg_price: 0, qty_avg_price: 0, from_cache: true, no_price: true };
    skipPrimaryFetch = true;
  }

  async function tryFetch(cond: string) {
    try {
      const qp = { guide_type: 'sold', new_or_used: cond, currency_code: currency, vat: 'N' };
      let g = await bricklinkRequest('GET', `/items/minifig/${figNumber}/price`, qp);
      // Wie bei Teilen: ohne Verkauf in sechs Monaten auf Angebote ausweichen.
      if (!hatPreis(g)) {
        const alt = await bricklinkRequest('GET', `/items/minifig/${figNumber}/price`,
          { ...qp, guide_type: 'stock' }).catch(meldeUndLiefere('preise:alt', null));
        if (hatPreis(alt)) g = alt;
      }
      const avg  = parseFloat(g?.avg_price || 0);
      const qavg = parseFloat(g?.qty_avg_price || 0);
      await db.run(`INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fig_number,condition,currency_code)
        DO UPDATE SET avg_price=$4, qty_avg_price=$5, fetched_at=NOW(), geschaetzt=FALSE, abdeckung=NULL`,
        [figNumber, cond, currency, avg, qavg]);
      // Verlaufspunkt mitschreiben — nur bei echtem Preis.
      // Ausführlich: docs/begruendungen/utils/finance/preise.ts.md#fetchminifigprice
      if (avg > 0 || qavg > 0) {
        await db.run(
          `INSERT INTO minifig_price_history (fig_number, condition, currency_code, avg_price, qty_avg_price)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [figNumber, cond, currency, avg, qavg]
        ).catch(logAndContinue('preise:figurverlauf schreiben'));
      }
      return { avg_price: avg, qty_avg_price: qavg, from_cache: false };
    } catch (e) {
      console.log(`  Minifig price failed ${figNumber} cond=${cond}: ${fehlertext(e)}`);
      return null;
    }
  }

  let pd: any = null;
  if (!skipPrimaryFetch) {
    const rl1 = await kontingentFrei('bricklink');
    if (!rl1.allowed) throw new Error('BrickLink Tageslimit erreicht');
    pd = await tryFetch(condition);
    if (hatPreis(pd)) return { ...pd, condition_used: condition };

    const cachedFallback = await readCache(fallbackCondition);
    if (hatPreis(cachedFallback))
      return { avg_price: parseFloat(cachedFallback.avg_price), qty_avg_price: parseFloat(cachedFallback.qty_avg_price), from_cache: true, condition_used: fallbackCondition, is_fallback: true };
  }

  const rl2 = await kontingentFrei('bricklink');
  if (!rl2.allowed) {
    if (pd) return { ...pd, condition_used: condition };
    throw new Error('BrickLink Tageslimit erreicht');
  }

  const pd2 = await tryFetch(fallbackCondition);
  if (hatPreis(pd2)) return { ...pd2, condition_used: fallbackCondition, is_fallback: true };
  if (pd2) return { ...pd2, condition_used: fallbackCondition };
  if (pd)  return { ...pd, condition_used: condition };
  return { avg_price: 0, qty_avg_price: 0, from_cache: false, error: 'kein BrickLink-Preis gefunden' };
}



export {
  DEFAULT_PRICE_CONDITION, PRICE_CACHE_COLS,
  speicherePreis, cacheUsable, preisAusCache,
  checkAndIncrementRateLimit, kontingentFrei, getLimitForApi, getRateLimitStatus,
  fetchPrice, parallelLimit, resolveBlColorId, resolveBlPartNumber,
  fetchPartPrice, fetchMinifigPrice, ladeTeilepreiseVor, ladeFigurenpreiseVor,
  farbkarte, ladeBlNummernVor,
  resolveSetCondition,
};
