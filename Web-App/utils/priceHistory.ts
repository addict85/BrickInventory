/**
 * Preisverlauf eines Sets — die EINE Umsetzung für Webapp und Android-API.
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#abschnitt
 */
import { kaufpreisIn } from './finance/abfragen';
import * as db from '../db/database';
import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } from './financeCalc';
import { asIds } from './household';
import { buildChart } from './chartData';
import { blNummerVon } from './blZuordnung';
import { entwicklungProzent } from './setValue';
import { konfig } from './konfig';

/**
 * Welche Zustaende gehoeren ins Diagramm?
 * Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#zustaendefuerverlauf
 * @param belegt    Zustaende mit Erfassung — die Schluessel von by_condition.
 * @param rueckfall Was gilt, wenn es GAR KEINE Erfassung gibt. Sonst verschwaende
 */
export function zustaendeFuerVerlauf(belegt: string[], rueckfall: string[]): string[] {
  return belegt.length ? belegt : rueckfall;
}

/** Mengengewichteter Schnitt über die Zeilen, in denen `k` einen Preis hat. */
const mittelUeber = (k: string) =>
  `SUM(${k} * quantity) FILTER (WHERE ${k} IS NOT NULL)::numeric / NULLIF(SUM(quantity) FILTER (WHERE ${k} IS NOT NULL), 0)`;

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
  );
}

/**
 * Vollständiger Preisverlauf samt aktuellen Preisen und Wertentwicklung.
 * @param uid Blickfeld (scopeIds()): Im Haushalt gehört das Set oft einem
 *   Unterkonto, mit der nackten Betrachter-ID fände die Abfrage es nicht.
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
  );
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
         SELECT ${kaufpreisIn('purchase_price', '$3')} AS purchase_price, created_at FROM set_acquisitions
          WHERE user_id = s.user_id AND set_number = s.set_number
          ORDER BY created_at ASC, id ASC LIMIT 1
       ) a ON true
      WHERE s.user_id = ANY($1) AND s.set_number=$2
      -- Bei mehreren Besitzern im Haushalt zählt die ÄLTESTE Erfassung —
      -- derselbe Massstab wie innerhalb eines Kontos.
      ORDER BY COALESCE(a.created_at, s.added_at) ASC LIMIT 1`,
    [uids, setNumber, currency]
  );

  const hasCost = set?.purchase_price != null;   // 0 zählt als erfasst
  const purchasePrice = parseFloat(set?.purchase_price || 0);

  // Der Kaufpreis als erster Punkt an der Reihe SEINES Zustands, sonst
  // vergliche das Diagramm einen Gebrauchtkauf mit dem Neupreis.
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
  const pnlPct = baselineHas ? entwicklungProzent(baselinePrice, currentPrice)?.toFixed(1) ?? null : null;

  // Marktpreis und Entwicklung JE ZUSTAND
  // Eine Zeile erscheint nur, wenn für diesen Zustand auch eine Erfassung
  // existiert — sonst stünde dort ein Marktpreis ohne Bezugsgrösse, und die
  // Prozentangabe daneben wäre gegen nichts gerechnet.
  // Ausführlich: docs/begruendungen/utils/priceHistory.ts.md#getsetpricehistory-acqbycond
  const acqByCond = await db.all(
    `SELECT condition, ${mittelUeber('k')} AS avg_purchase, SUM(quantity) AS qty
       FROM (SELECT condition, quantity, ${kaufpreisIn('purchase_price', '$3')} AS k
               FROM set_acquisitions
              -- Über ALLE Haushalts-Besitzer verdichtet — dieselbe Mengengewichtung,
              -- die auch die Bewertung im Haushalt anwendet.
              WHERE user_id = ANY($1) AND set_number = $2) e
      GROUP BY condition`,
    [uids, setNumber, currency]
  );

  const byCondition: Record<string, any> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqByCond.find((r: any) => (r.condition || 'N') === cond);
    if (!acq) continue;                       // kein Kaufpreis-Eintrag → keine Zeile
    const market = parseFloat(String((cond === 'N' ? current.N : current.U)?.avg_price || 0)) || null;
    // null = kein Kaufpreis erfasst, 0 = Geschenk; beides ohne Prozentangabe.
    const base   = acq.avg_purchase == null ? null : parseFloat(String(acq.avg_purchase));
    const e = entwicklungProzent(base, market);
    byCondition[cond] = {
      market_price: market,
      purchase_price: base,
      pnl_pct: e == null ? null : parseFloat(e.toFixed(1)),
    };
  }

  // Im Diagramm nur Zustände mit Erfassung — dieselbe Regel wie by_condition.
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
    // pnl_pct als Zahl; das Textfeld bleibt für ältere Clients.
    pnl_prozent: pnlPct == null ? null : Number(pnlPct),
    purchase_price: hasCost ? purchasePrice : null,
    chart,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Preisverlauf manueller Teile und Minifiguren
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Dieselbe Antwortform wie für Sets; Web und App fragen beide hier.
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
  );
}

/**
 * Marktpreis und Entwicklung je Zustand für ein manuelles Teil / eine Figur —
 * nur für Zustände mit Erfassung, sonst fehlte der Prozentangabe die Basis.
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
  );
  // Eigener Schlüssel: Erfassungen tragen die Rebrickable-Nummer, der Cache
  // oben die BrickLink-Nummer.
  const acqRows = await db.all(
    `SELECT condition, ${mittelUeber('k')} AS avg_purchase
       FROM (SELECT condition, quantity, ${kaufpreisIn('unit_price', `$${acqKeyVals.length + 2}`)} AS k
               FROM ${acqTable}
              WHERE ${acqKeySql} AND user_id = ANY($${acqKeyVals.length + 1})) e
      GROUP BY condition`,
    [...acqKeyVals, uids, currency]
  );

  const out: Record<string, any> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqRows.find((r: any) => (r.condition || 'N') === cond);
    if (!acq) continue;                       // kein Kaufpreis-Eintrag → keine Zeile
    const market = parseFloat(String(cacheRows.find((r: any) => r.condition === cond)?.avg_price || 0)) || null;
    const base   = acq.avg_purchase == null ? null : parseFloat(String(acq.avg_purchase));
    const e = entwicklungProzent(base, market);
    out[cond] = {
      market_price: market,
      purchase_price: base,
      pnl_pct: e == null ? null : parseFloat(e.toFixed(1)),
    };
  }
  return out;
}

/**
 * Gemeinsamer Aufbau für Teile und Figuren.
 * @param keySql/keyVals  Schlüssel für PREISE (stehen unter der BrickLink-Nummer).
 * @param acqKeySql/acqKeyVals  Schlüssel für ERFASSUNGEN (Nummer des Benutzers).
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
  // Gezeichnet werden nur Zustände mit Erfassung (wie bei Sets); die
  // Rohreihen history_new/history_used bleiben vollständig.
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
  const tage = konfig().preisverlaufTage;
  if (tage <= 0) return 0;
  const r = await db.run(
    `DELETE FROM price_history
      WHERE recorded_at < NOW() - ($1 || ' days')::interval`,
    [String(tage)]
  ).catch(() => ({ changes: 0 }));
  return r?.changes || 0;
}

export { purgeAltePreise };
