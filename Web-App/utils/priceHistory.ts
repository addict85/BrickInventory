/**
 * Preisverlauf eines Sets — die EINE Umsetzung für Webapp und Android-API.
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#abschnitt
 */
import { inKontowaehrung } from './acquisitions';
import * as db from '../db/database';
import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } from './financeCalc';
import { asIds } from './household';
import { buildChart } from './chartData';
import { blNummerVon } from './blZuordnung';

/**
 * Welche Zustaende gehoeren ins Diagramm?
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#zustaendefuerverlauf
 * @param belegt    Zustaende mit Erfassung — die Schluessel von by_condition.
 * @param rueckfall Was gilt, wenn es GAR KEINE Erfassung gibt. Sonst verschwaende
 */
export function zustaendeFuerVerlauf(belegt: string[], rueckfall: string[]): string[] {
  return belegt.length ? belegt : rueckfall;
}

/** Ein Punkt im Verlauf. */
export interface PricePoint {
  avg_price: number | null;
  qty_avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  recorded_at: string;
  /** Nur beim vorangestellten Kaufpreis gesetzt. */
  is_purchase_price?: boolean;
}

/**
 * Eine Reihe je Zustand, tagesweise verdichtet.
 *
 * DISTINCT ON je Tag: Mehrere Abrufe am selben Tag ergäben sonst mehrere
 * Punkte übereinander. Genommen wird der jüngste des Tages.
 */
async function seriesFor(setNumber: string, currency: string, cond: 'N' | 'U'): Promise<PricePoint[]> {
  return db.all(
    `SELECT DISTINCT ON (to_char(recorded_at, 'YYYY-MM-DD'))
            qty_avg_price, avg_price, min_price, max_price,
            to_char(recorded_at, 'YYYY-MM-DD') AS recorded_at
       FROM price_history
      WHERE set_number = $1 AND currency_code = $2 AND condition = $3
      ORDER BY to_char(recorded_at, 'YYYY-MM-DD') ASC, recorded_at DESC`,
    [setNumber, currency, cond]
  ).catch(() => []);
}

/**
 * Vollständiger Preisverlauf samt aktuellen Preisen und Wertentwicklung.
 *
 * @param {number} uid
 * @param {string} setNumber
 * @param {string} currency
 */
/**
 * @param uid Betrachter-BLICKFELD: eine ID oder die Liste aus scopeIds().
 *
 * ── Warum die Liste (Nachtrag 33) ───────────────────────────────────────────
 * Im Haushalt gehört das Set oft einem UNTERKONTO. Mit der nackten
 * Betrachter-ID fanden die Abfragen hier weder das Set noch die Erfassungen:
 * by_condition blieb leer, der Kaufpreis-Punkt fehlte, und die Detailansicht
 * der App zeigte für jedes fremde Haushalts-Set weder Marktpreis je Zustand
 * noch Wertentwicklung — während die (längst über scopeIds laufende)
 * Finanzübersicht dieselben Sets korrekt bewertete. resolveSetCondition()
 * konnte das Blickfeld immer schon; hier kam es nur nie an.
 */
export async function getSetPriceHistory(uid: number | number[], setNumber: string, currency: string) {
  const uids = asIds(uid as any);
  const condition = await resolveSetCondition(uids, setNumber);

  const [historyNew, historyUsed] = await Promise.all([
    seriesFor(setNumber, currency, 'N'),
    seriesFor(setNumber, currency, 'U'),
  ]);

  // Aktueller Preis je Zustand — für die zwei Zeilen im Detail-Dialog.
  const currentRows = await db.all(
    `SELECT condition, avg_price, min_price, max_price, fetched_at
       FROM price_cache
      WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND avg_price > 0`,
    [setNumber, currency]
  ).catch(() => []);
  const current = {
    N: currentRows.find((r: any) => r.condition === 'N') || null,
    U: currentRows.find((r: any) => r.condition === 'U') || null,
  };

  // Kaufpreis: aus der ERSTEN Erfassung. Der Rückfall auf s.purchase_price ist
  // mit Migration 0032 weggefallen — die Spalte gibt es nicht mehr, und jede
  // Set-Zeile hat mindestens eine Erfassung.
  const set = await db.get(
    `SELECT a.purchase_price AS purchase_price,
            to_char(COALESCE(a.created_at, s.added_at), 'YYYY-MM-DD') AS added_day
       FROM sets s
       LEFT JOIN LATERAL (
         SELECT purchase_price, created_at FROM set_acquisitions
          WHERE user_id = s.user_id AND set_number = s.set_number
          ORDER BY created_at ASC, id ASC LIMIT 1
       ) a ON true
      WHERE s.user_id = ANY($1) AND s.set_number=$2
      -- Bei mehreren Besitzern im Haushalt zählt die ÄLTESTE Erfassung —
      -- derselbe Massstab wie innerhalb eines Kontos.
      ORDER BY COALESCE(a.created_at, s.added_at) ASC LIMIT 1`,
    [uids, setNumber]
  ).catch(() => null);

  const hasCost = set?.purchase_price != null;   // 0 zählt als erfasst
  const purchasePrice = parseFloat(set?.purchase_price || 0);

  // Als erster Punkt AN DER PASSENDEN REIHE.
  //
  // Vorher hing er an der einen zusammengefalteten Reihe. Bei zwei Linien wäre
  // das ein Vergleich von Gebrauchtkauf und Neupreis-Verlauf — genau die
  // Vermischung, aus der die „−32 %"-Meldung entstanden ist.
  if (hasCost && set?.added_day) {
    const target = condition === 'U' ? historyUsed : historyNew;
    const firstDay = target[0]?.recorded_at;
    if (!firstDay || set.added_day <= firstDay) {
      target.unshift({
        qty_avg_price: purchasePrice, avg_price: purchasePrice,
        min_price: null, max_price: null,
        recorded_at: set.added_day, is_purchase_price: true,
      });
    }
  }

  // ── Wertentwicklung ───────────────────────────────────────────────────────
  // Bezugsgrösse ist der Kaufpreis; ohne erfassten Kaufpreis der älteste
  // bekannte Marktpreis. Verglichen wird gegen den AKTUELLEN Preis im Zustand
  // des Bestandes — nicht gegen den jeweils höheren.
  const own = condition === 'U' ? historyUsed : historyNew;
  const firstMarket = own.find(p => !p.is_purchase_price);
  const firstHistPrice = parseFloat(String(firstMarket?.avg_price || 0));
  const baselinePrice = hasCost ? purchasePrice : firstHistPrice;
  const baselineHas   = hasCost || firstHistPrice > 0;
  const currentPrice  = parseFloat(String((condition === 'U' ? current.U : current.N)?.avg_price || 0));
  // Kaufpreis 0 gegen eine sehr kleine Zahl rechnen, sonst wäre die Steigerung
  // nicht berechenbar.
  const pnlPct = (baselineHas && currentPrice > 0)
    ? ((currentPrice - baselinePrice) / Math.max(baselinePrice, 0.01) * 100).toFixed(1)
    : null;

  // Marktpreis und Entwicklung JE ZUSTAND
  // Eine Zeile erscheint nur, wenn für diesen Zustand auch eine Erfassung
  // existiert — sonst stünde dort ein Marktpreis ohne Bezugsgrösse, und die
  // Prozentangabe daneben wäre gegen nichts gerechnet.
  // Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#getsetpricehistory-acqbycond
  const acqByCond = await db.all(
    `SELECT condition,
            SUM(purchase_price * quantity) FILTER (WHERE purchase_price IS NOT NULL AND ${inKontowaehrung('set_acquisitions')})::numeric
              / NULLIF(SUM(quantity) FILTER (WHERE purchase_price IS NOT NULL AND ${inKontowaehrung('set_acquisitions')}), 0) AS avg_purchase,
            SUM(quantity) AS qty
       FROM set_acquisitions
      -- Über ALLE Haushalts-Besitzer verdichtet — dieselbe Mengengewichtung,
      -- die auch die Bewertung im Haushalt anwendet.
      WHERE user_id = ANY($1) AND set_number=$2
      GROUP BY condition`,
    [uids, setNumber]
  ).catch(() => []);

  const byCondition: Record<string, any> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqByCond.find((r: any) => (r.condition || 'N') === cond);
    if (!acq) continue;                       // kein Kaufpreis-Eintrag → keine Zeile
    const market = parseFloat(String((cond === 'N' ? current.N : current.U)?.avg_price || 0)) || null;
    const base   = parseFloat(String(acq.avg_purchase || 0));
    byCondition[cond] = {
      market_price: market,
      purchase_price: base > 0 ? base : null,
      // Ohne Kaufpreis oder ohne Marktpreis keine Prozentangabe — eine Zahl
      // gegen 0 gerechnet wäre bedeutungslos.
      pnl_pct: (base > 0 && market)
        ? parseFloat(((market - base) / base * 100).toFixed(1))
        : null,
    };
  }

  // Diagrammdaten: nur die Zustände, die auch im Bestand liegen
  // Die Regel gab es bereits — zwei Blöcke weiter oben, für `by_condition`:
  // Eine Zeile erscheint nur, wenn für diesen Zustand eine Erfassung existiert.
  // Der Diagramm-Aufbau stand davor und kannte sie nicht; er nahm immer beide …
  // Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#getsetpricehistory-zustaendefuerchart
  const zustaendeFuerChart = zustaendeFuerVerlauf(Object.keys(byCondition), [condition]);
  const chart = buildChart(
    zustaendeFuerChart.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew }))
  );

  return {
    currency, condition,
    by_condition: byCondition,
    history_new: historyNew,
    history_used: historyUsed,
    current,
    pnl_pct: pnlPct,
    purchase_price: hasCost ? purchasePrice : null,
    chart,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Preisverlauf manueller Teile und Minifiguren
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Dieselbe Antwortform wie oben für Sets — und aus demselben Grund hier und
 * nicht in einer Routendatei: Die Android-API braucht sie jetzt ebenfalls
 * (/api/v1/parts/:nummer/:farbe/price-history und
 * /api/v1/minifigs/:nummer/price-history), und der Set-Verlauf ist genau daran …
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#manualseries
 */

/** Tagesweise verdichtete Reihe aus einer der beiden Verlaufstabellen. */
async function manualSeries(table: string, keySql: string, keyVals: any[], currency: string, cond: 'N' | 'U') {
  return db.all(
    `SELECT DISTINCT ON (to_char(recorded_at, 'YYYY-MM-DD'))
            avg_price, qty_avg_price, to_char(recorded_at, 'YYYY-MM-DD') AS recorded_at
       FROM ${table}
      WHERE ${keySql} AND currency_code = $${keyVals.length + 1} AND condition = $${keyVals.length + 2}
      ORDER BY to_char(recorded_at, 'YYYY-MM-DD') ASC, recorded_at DESC`,
    [...keyVals, currency, cond]
  ).catch(() => []);
}

/**
 * Marktpreis und Entwicklung je Zustand für ein manuelles Teil / eine Minifigur.
 *
 * Gleiche Regel wie bei Sets: Eine Zeile entsteht nur für Zustände, zu denen
 * eine Erfassung existiert — sonst stünde ein Marktpreis ohne Bezugsgrösse da,
 * und die Prozentangabe wäre gegen nichts gerechnet.
 */
export async function conditionRows(
  cacheTable: string, acqTable: string, keySql: string, keyVals: any[], uid: number | number[], currency: string,
  acqKeySql: string = keySql, acqKeyVals: any[] = keyVals
) {
  const uids = asIds(uid as any);
  // ORDER BY fetched_at DESC, damit `.find()` unten den NEUESTEN Eintrag
  // nimmt. Solange der Schlüssel genau eine Zeile je Zustand traf, war die
  // Reihenfolge gleichgültig; seit der Minifiguren-Verlauf beide Nummern
  // abfragt (siehe getMinifigPriceHistory), kann es zwei geben.
  const cacheRows = await db.all(
    `SELECT condition, avg_price FROM ${cacheTable}
      WHERE ${keySql} AND currency_code = $${keyVals.length + 1} AND avg_price > 0
      ORDER BY fetched_at DESC`,
    [...keyVals, currency]
  ).catch(() => []);
  // Eigener Schlüssel: Erfassungen tragen die Rebrickable-Nummer, der Cache
  // oben die BrickLink-Nummer (Nachtrag 143).
  const acqRows = await db.all(
    `SELECT condition,
            SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung(acqTable)})::numeric
              / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung(acqTable)}), 0) AS avg_purchase
       FROM ${acqTable}
      WHERE ${acqKeySql} AND user_id = ANY($${acqKeyVals.length + 1})
      GROUP BY condition`,
    [...acqKeyVals, uids]
  ).catch(() => []);

  const out: Record<string, any> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqRows.find((r: any) => (r.condition || 'N') === cond);
    if (!acq) continue;                       // kein Kaufpreis-Eintrag → keine Zeile
    const market = parseFloat(String(cacheRows.find((r: any) => r.condition === cond)?.avg_price || 0)) || null;
    const base   = parseFloat(String(acq.avg_purchase || 0));
    out[cond] = {
      market_price: market,
      purchase_price: base > 0 ? base : null,
      pnl_pct: (base > 0 && market) ? parseFloat(((market - base) / base * 100).toFixed(1)) : null,
    };
  }
  return out;
}

/**
 * Gemeinsamer Aufbau für beide Arten.
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#abschnitt-2
 */
/**
 * @param keySql/keyVals  Schlüssel für PREISE (Cache und Verlauf).
 * @param acqKeySql/acqKeyVals  Schlüssel für ERFASSUNGEN. Ohne Angabe
 *   dieselben. Bei Teilen weichen sie ab: Preise stehen unter der
 *   BrickLink-Nummer, Erfassungen unter der Rebrickable-Nummer (Nachtrag 143).
 *
 *   Hier stand „bei Minifiguren stimmen beide überein". Das war falsch, und
 *   die Annahme kostete dort denselben Fehler: Sobald eine Figur eine eigene
 *   bl_fig_number trägt, schreibt fetchMinifigPrice Cache und Verlauf UNTER
 *   DIESER Nummer, die Erfassungen tragen aber die des Benutzers. Siehe
 *   getMinifigPriceHistory.
 */
async function manualPriceHistory(
  uid: number | number[], currency: string,
  historyTable: string, cacheTable: string, acqTable: string,
  keySql: string, keyVals: any[],
  acqKeySql: string = keySql, acqKeyVals: any[] = keyVals
) {
  const [historyNew, historyUsed, by_condition] = await Promise.all([
    manualSeries(historyTable, keySql, keyVals, currency, 'N'),
    manualSeries(historyTable, keySql, keyVals, currency, 'U'),
    conditionRows(cacheTable, acqTable, keySql, keyVals, uid, currency, acqKeySql, acqKeyVals),
  ]);
  // Nur Zustaende mit Erfassung ins Diagramm — dieselbe Regel wie bei den
  // Sets, und seit Marcos Befund an EINER Stelle (zustaendeFuerVerlauf).
  // Ohne sie zeichnete ein nur gebraucht gekauftes Teil auch eine Linie
  // „neu", die gegen keinen Kaufpreis steht.
  //
  // history_new/history_used bleiben VOLLSTAENDIG in der Antwort: Sie sind die
  // Rohdaten, und wer sie auswertet (nicht das Diagramm) soll nicht
  // stillschweigend weniger bekommen. Gefiltert wird, was GEZEICHNET wird.
  const zustaende = zustaendeFuerVerlauf(Object.keys(by_condition), ['N', 'U']);
  return {
    currency, by_condition,
    history_new: historyNew, history_used: historyUsed,
    chart: buildChart(zustaende.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew }))),
  };
}

/** Preisverlauf eines manuell erfassten Teils. */
export async function getPartPriceHistory(uid: number | number[], partNumber: string, colorId: number, currency: string) {
  // Zwei Schlüsselräume, die man nicht mischen darf
  // `part_price_cache` und `part_price_history` werden von fetchPartPrice()
  // geschrieben — und zwar unter der BRICKLINK-Teilenummer und der
  // BRICKLINK-Farbnummer (resolveBlPartNumber / resolveBlColorId). BrickLink …
  // Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#getpartpricehistory-blnummer
  const blNummer = await resolveBlPartNumber(partNumber);
  const blFarbe  = await resolveBlColorId(colorId);
  const nummern  = [...new Set([blNummer, partNumber])];
  return manualPriceHistory(uid, currency,
    'part_price_history', 'part_price_cache', 'part_acquisitions',
    'part_number = ANY($1) AND color_id = $2', [nummern, blFarbe],
    'part_number = $1 AND color_id = $2', [partNumber, colorId]);
}

/**
 * Preisverlauf einer manuell erfassten Minifigur (ohne Farbe).
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#getminifigpricehistory
 */
export async function getMinifigPriceHistory(uid: number | number[], figNumber: string, currency: string) {
  const nummern = await preisNummernFuerFigur(uid, figNumber);
  return manualPriceHistory(uid, currency,
    'minifig_price_history', 'minifig_price_cache', 'minifig_acquisitions',
    'fig_number = ANY($1)', [nummern],
    // Die Erfassungen tragen ausschliesslich die Nummer des Benutzers — so
    // hat er sie eingegeben.
    'fig_number = $1', [figNumber]);
}

/**
 * Unter welchen Nummern können die Preise dieser Figur liegen?
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#preisnummernfuerfigur
 */
async function preisNummernFuerFigur(_uid: number | number[], figNumber: string): Promise<string[]> {
  const bl = await blNummerVon('fig', figNumber);
  return [...new Set([figNumber, ...(bl ? [bl] : [])])];
}

/**
 * Alte Preis-Zeilen entfernen.
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#purgealtepreise
 * @returns Anzahl entfernter Zeilen
 */
async function purgeAltePreise(): Promise<number> {
  const roh = process.env.PRICE_HISTORY_KEEP_DAYS;
  const tage = roh === undefined ? 1095 : parseInt(roh);
  if (!Number.isFinite(tage) || tage <= 0) return 0;
  const r = await db.run(
    `DELETE FROM price_history
      WHERE recorded_at < NOW() - ($1 || ' days')::interval`,
    [String(tage)]
  ).catch(() => ({ changes: 0 }));
  return r?.changes || 0;
}

export { purgeAltePreise };
