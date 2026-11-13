/** Die EINE Umsetzung für Webapp und Android-API, damit beide dasselbe Diagramm zeigen. */

import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } from './financeCalc';
import { asIds, blickfeldAus, type Sicht } from '../haushalt';
import { buildChart } from './chartData';
import { marktpreisAus } from '../katalog';
import { entwicklungProzent } from './setValue';
import { konfig } from '../infra/konfig';
import type { FinanzenKontext } from './kontext';

/** Nur Zustände mit Erfassung: Sonst stünde eine Kurve ohne Bezugsgrösse da.
 * @param rueckfall Was gilt, wenn es GAR KEINE Erfassung gibt. */
export function zustaendeFuerVerlauf(belegt: string[], rueckfall: string[]): string[] {
  return belegt.length ? belegt : rueckfall;
}

export interface PricePoint {
  avg_price: number | null;
  qty_avg_price: number | null;
  min_price: number | null;
  max_price: number | null;
  recorded_at: string;
  is_purchase_price?: boolean;
}

/** DISTINCT ON je Tag: Mehrere Abrufe am selben Tag ergäben sonst Punkte
 * übereinander. Genommen wird der jüngste des Tages. */
async function seriesFor(
  k: FinanzenKontext,
  setNumber: string,
  currency: string,
  cond: 'N' | 'U',
): Promise<PricePoint[]> {
  return k.preisverlauf.tagespreiseDesSets(setNumber, currency, cond);
}

/** Markt- gegen Kaufpreis in einem Zustand; pnl_pct ist die alte Textform. */
interface ZustandsVergleich {
  market_price: number | null;
  purchase_price: number | null;
  pnl_pct: string | null;
  pnl_prozent: number | null;
}

/** @param uid Blickfeld: Im Haushalt gehört das Set oft einem Unterkonto, mit
 *   der nackten Betrachter-ID fände die Abfrage es nicht. */
export async function preisverlaufSet(
  k: FinanzenKontext,
  uidWahl: Sicht | number | number[],
  setNumber: string,
  currency: string,
) {
  const uids = asIds(await blickfeldAus(k.db, uidWahl));
  const condition = await resolveSetCondition(k, uids, setNumber);

  const [historyNew, historyUsed] = await Promise.all([
    seriesFor(k, setNumber, currency, 'N'),
    seriesFor(k, setNumber, currency, 'U'),
  ]);

  const currentRows = await k.preisverlauf.cachePreiseDesSets(setNumber, currency);
  const jetzt = (c: string) => {
    const r = currentRows.find(z => z.condition === c);
    return r ? { ...r, avg_price: marktpreisAus(r) } : null;
  };
  const current = { N: jetzt('N'), U: jetzt('U') };

  // Kaufpreis aus der ERSTEN Erfassung; jede Set-Zeile hat mindestens eine.
  const set = await k.preisverlauf.ersterKaufDesSets(uids, setNumber, currency);

  const hasCost = set?.purchase_price != null; // 0 zählt als erfasst
  const purchasePrice = Number(set?.purchase_price ?? 0);

  // An der Reihe SEINES Zustands, sonst vergliche das Diagramm einen
  // Gebrauchtkauf mit dem Neupreis.
  if (hasCost && set?.added_day) {
    const target = condition === 'U' ? historyUsed : historyNew;
    const firstDay = target[0]?.recorded_at;
    if (!firstDay || set.added_day <= firstDay) {
      target.unshift({
        qty_avg_price: purchasePrice,
        avg_price: purchasePrice,
        min_price: null,
        max_price: null,
        recorded_at: set.added_day,
        is_purchase_price: true,
      });
    }
  }

  // Gegen den AKTUELLEN Preis im Zustand des Bestandes, nicht gegen den
  // jeweils höheren; ohne Kaufpreis gegen den ältesten Marktpreis.
  const own = condition === 'U' ? historyUsed : historyNew;
  const firstMarket = own.find(p => !p.is_purchase_price);
  const firstHistPrice = marktpreisAus(firstMarket) ?? 0;
  const baselinePrice = hasCost ? purchasePrice : firstHistPrice;
  const baselineHas = hasCost || firstHistPrice > 0;
  const currentPrice = marktpreisAus(condition === 'U' ? current.U : current.N) ?? 0;
  const pnlPct = baselineHas ? (entwicklungProzent(baselinePrice, currentPrice)?.toFixed(1) ?? null) : null;

  // Nur Zustände mit Erfassung, sonst stünde eine Prozentangabe gegen nichts da.
  const acqByCond = await k.preisverlauf.kaufschnittDesSets(uids, setNumber, currency);

  const byCondition: Record<string, ZustandsVergleich> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqByCond.find(r => (r.condition || 'N') === cond);
    if (!acq) continue; // kein Kaufpreis-Eintrag → keine Zeile
    const market = marktpreisAus(cond === 'N' ? current.N : current.U);
    // null = kein Kaufpreis erfasst, 0 = Geschenk; beides ohne Prozentangabe.
    const base = acq.avg_purchase == null ? null : parseFloat(String(acq.avg_purchase));
    const e = entwicklungProzent(base, market);
    byCondition[cond] = {
      market_price: market,
      purchase_price: base,
      pnl_pct: e == null ? null : e.toFixed(1),
      pnl_prozent: e == null ? null : Number(e.toFixed(1)),
    };
  }

  const zustaendeFuerChart = zustaendeFuerVerlauf(Object.keys(byCondition), [condition]);
  const chart = buildChart(zustaendeFuerChart.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew })));

  return {
    currency,
    condition,
    by_condition: byCondition,
    history_new: historyNew,
    history_used: historyUsed,
    current,
    pnl_pct: pnlPct,
    pnl_prozent: pnlPct == null ? null : Number(pnlPct),
    purchase_price: hasCost ? purchasePrice : null,
    chart,
  };
}

// ── Preisverlauf manueller Teile und Minifiguren ────────────────────────────
// Dieselbe Antwortform wie für Sets; Web und App fragen beide hier.

/** Nur für Zustände mit Erfassung, sonst fehlte der Prozentangabe die Basis. */
export async function conditionRows(
  k: FinanzenKontext,
  cacheTable: string,
  acqTable: string,
  keySql: string,
  keyVals: unknown[],
  uid: number | number[],
  currency: string,
  acqKeySql: string = keySql,
  acqKeyVals: unknown[] = keyVals,
) {
  const uids = asIds(uid);
  // DESC: Seit der Figuren-Verlauf beide Nummern abfragt, kann es zwei Zeilen
  // je Zustand geben, und `.find()` soll die neueste nehmen.
  const cacheRows = await k.preisverlauf.cachePreiseNachSchluessel(cacheTable, keySql, keyVals, currency);
  const acqRows = await k.preisverlauf.kaufschnitteNachSchluessel(acqTable, acqKeySql, acqKeyVals, uids, currency);

  const out: Record<string, ZustandsVergleich> = {};
  for (const cond of ['N', 'U'] as const) {
    const acq = acqRows.find(r => (r.condition || 'N') === cond);
    if (!acq) continue; // kein Kaufpreis-Eintrag → keine Zeile
    const market = marktpreisAus(cacheRows.find(r => r.condition === cond));
    const base = acq.avg_purchase == null ? null : parseFloat(String(acq.avg_purchase));
    const e = entwicklungProzent(base, market);
    out[cond] = {
      market_price: market,
      purchase_price: base,
      pnl_pct: e == null ? null : e.toFixed(1),
      pnl_prozent: e == null ? null : Number(e.toFixed(1)),
    };
  }
  return out;
}

/** @param keySql/keyVals  Schlüssel für PREISE (unter der BrickLink-Nummer).
 * @param acqKeySql/acqKeyVals  Schlüssel für ERFASSUNGEN (Nummer des Benutzers). */
async function manualPriceHistory(
  k: FinanzenKontext,
  uid: number | number[],
  currency: string,
  historyTable: string,
  cacheTable: string,
  acqTable: string,
  keySql: string,
  keyVals: unknown[],
  acqKeySql: string = keySql,
  acqKeyVals: unknown[] = keyVals,
) {
  const [historyNew, historyUsed, by_condition] = await Promise.all([
    k.preisverlauf.manualSeries(historyTable, keySql, keyVals, currency, 'N'),
    k.preisverlauf.manualSeries(historyTable, keySql, keyVals, currency, 'U'),
    conditionRows(k, cacheTable, acqTable, keySql, keyVals, uid, currency, acqKeySql, acqKeyVals),
  ]);
  // Gezeichnet werden nur Zustände mit Erfassung; die Rohreihen bleiben vollständig.
  const zustaende = zustaendeFuerVerlauf(Object.keys(by_condition), ['N', 'U']);
  return {
    currency,
    by_condition,
    history_new: historyNew,
    history_used: historyUsed,
    chart: buildChart(zustaende.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew }))),
  };
}

export async function preisverlaufTeil(
  k: FinanzenKontext,
  uidWahl: Sicht | number | number[],
  partNumber: string,
  colorId: number,
  currency: string,
) {
  const uid = await k.haushalt.haushalt.blickfeldAus(uidWahl);
  // Preise liegen unter BrickLink-Nummer und -Farbe, Erfassungen unter denen
  // des Benutzers — die beiden Schlüsselräume dürfen nicht gemischt werden.
  const blNummer = await resolveBlPartNumber(k, partNumber, Array.isArray(uid) ? (uid[0] ?? null) : uid);
  const blFarbe = await resolveBlColorId(k, colorId);
  const nummern = [...new Set([blNummer, partNumber])];
  return manualPriceHistory(
    k,
    uid,
    currency,
    'part_price_history',
    'part_price_cache',
    'part_acquisitions',
    'part_number = ANY($1) AND color_id = $2',
    [nummern, blFarbe],
    'part_number = $1 AND color_id = $2',
    [partNumber, colorId],
  );
}

// Preise stehen unter der BrickLink-Nummer, Erfassungen unter der eigenen; beide Schlüssel zählen.
export async function preisverlaufFigur(
  k: FinanzenKontext,
  uidWahl: Sicht | number | number[],
  figNumber: string,
  currency: string,
) {
  const uid = await k.haushalt.haushalt.blickfeldAus(uidWahl);
  const nummern = await preisNummernFuerFigur(k, uid, figNumber);
  return manualPriceHistory(
    k,
    uid,
    currency,
    'minifig_price_history',
    'minifig_price_cache',
    'minifig_acquisitions',
    'fig_number = ANY($1)',
    [nummern],
    // Die Erfassungen tragen nur die Nummer des Benutzers.
    'fig_number = $1',
    [figNumber],
  );
}

/** Die eigene und, falls hinterlegt, die BrickLink-Nummer; doppelte fallen weg. */
async function preisNummernFuerFigur(k: FinanzenKontext, uid: number | number[], figNumber: string): Promise<string[]> {
  const bl = await k.katalog.blNummerVon('fig', figNumber, uid);
  return [...new Set([figNumber, ...(bl ? [bl] : [])])];
}

/** @returns Anzahl entfernter Zeilen */
export async function purgeAltePreise(k: FinanzenKontext): Promise<number> {
  const tage = konfig().preisverlaufTage;
  if (tage <= 0) return 0;
  const r = await k.preisverlauf.loescheAltenVerlauf(String(tage));
  return r?.changes || 0;
}
