/** Die EINE Umsetzung für Webapp und Android-API, damit beide dasselbe Diagramm zeigen.
 * Ausführlich: docs/begruendungen/src/finanzen/priceHistory.ts.md#abschnitt */
import { meldeUndLiefere } from '../infra/fehler';
import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } from './financeCalc';
import { asIds, blickfeldAus, type Sicht } from '../haushalt/haushalt';
import { buildChart } from './chartData';
import { blNummerVon } from '../katalog/blZuordnung';
import { entwicklungProzent } from './setValue';
import { konfig } from '../infra/konfig';
import * as repo from './repository/preisverlauf';

/** Nur Zustände mit Erfassung: Sonst stünde eine Kurve ohne Bezugsgrösse da.
 * Ausführlich: docs/begruendungen/src/finanzen/priceHistory.ts.md#zustaendefuerverlauf
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
async function seriesFor(setNumber: string, currency: string, cond: 'N' | 'U'): Promise<PricePoint[]> {
  return repo.tagespreiseDesSets(setNumber, currency, cond);
}

/** @param uid Blickfeld: Im Haushalt gehört das Set oft einem Unterkonto, mit
 *   der nackten Betrachter-ID fände die Abfrage es nicht. */
export async function getSetPriceHistory(uidWahl: Sicht | number | number[], setNumber: string, currency: string) {
  const uid = await blickfeldAus(uidWahl);
  const uids = asIds(uid as any);
  const condition = await resolveSetCondition(uids, setNumber);

  const [historyNew, historyUsed] = await Promise.all([
    seriesFor(setNumber, currency, 'N'),
    seriesFor(setNumber, currency, 'U'),
  ]);

  const currentRows = await repo.cachePreiseDesSets(setNumber, currency);
  const current = {
    N: currentRows.find((r: any) => r.condition === 'N') || null,
    U: currentRows.find((r: any) => r.condition === 'U') || null,
  };

  // Kaufpreis aus der ERSTEN Erfassung; jede Set-Zeile hat mindestens eine.
  const set = await repo.ersterKaufDesSets(uids, setNumber, currency);

  const hasCost = set?.purchase_price != null;   // 0 zählt als erfasst
  const purchasePrice = Number(set?.purchase_price ?? 0);

  // An der Reihe SEINES Zustands, sonst vergliche das Diagramm einen
  // Gebrauchtkauf mit dem Neupreis.
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

  // Gegen den AKTUELLEN Preis im Zustand des Bestandes, nicht gegen den
  // jeweils höheren; ohne Kaufpreis gegen den ältesten Marktpreis.
  const own = condition === 'U' ? historyUsed : historyNew;
  const firstMarket = own.find(p => !p.is_purchase_price);
  const firstHistPrice = parseFloat(String(firstMarket?.avg_price || 0));
  const baselinePrice = hasCost ? purchasePrice : firstHistPrice;
  const baselineHas   = hasCost || firstHistPrice > 0;
  const currentPrice  = parseFloat(String((condition === 'U' ? current.U : current.N)?.avg_price || 0));
  const pnlPct = baselineHas ? entwicklungProzent(baselinePrice, currentPrice)?.toFixed(1) ?? null : null;

  // Nur Zustände mit Erfassung, sonst stünde eine Prozentangabe gegen nichts da.
  const acqByCond = await repo.kaufschnittDesSets(uids, setNumber, currency);

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

// ── Preisverlauf manueller Teile und Minifiguren ────────────────────────────
// Dieselbe Antwortform wie für Sets; Web und App fragen beide hier.


/** Nur für Zustände mit Erfassung, sonst fehlte der Prozentangabe die Basis. */
export async function conditionRows(
  cacheTable: string, acqTable: string, keySql: string, keyVals: any[], uid: number | number[], currency: string,
  acqKeySql: string = keySql, acqKeyVals: any[] = keyVals
) {
  const uids = asIds(uid as any);
  // DESC: Seit der Figuren-Verlauf beide Nummern abfragt, kann es zwei Zeilen
  // je Zustand geben, und `.find()` soll die neueste nehmen.
  const cacheRows = await repo.cachePreiseNachSchluessel(cacheTable, keySql, keyVals, currency);
  const acqRows = await repo.kaufschnitteNachSchluessel(acqTable, acqKeySql, acqKeyVals, uids, currency);

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

/** @param keySql/keyVals  Schlüssel für PREISE (unter der BrickLink-Nummer).
 * @param acqKeySql/acqKeyVals  Schlüssel für ERFASSUNGEN (Nummer des Benutzers). */
async function manualPriceHistory(
  uid: number | number[], currency: string,
  historyTable: string, cacheTable: string, acqTable: string,
  keySql: string, keyVals: any[],
  acqKeySql: string = keySql, acqKeyVals: any[] = keyVals
) {
  const [historyNew, historyUsed, by_condition] = await Promise.all([
    repo.manualSeries(historyTable, keySql, keyVals, currency, 'N'),
    repo.manualSeries(historyTable, keySql, keyVals, currency, 'U'),
    conditionRows(cacheTable, acqTable, keySql, keyVals, uid, currency, acqKeySql, acqKeyVals),
  ]);
  // Gezeichnet werden nur Zustände mit Erfassung; die Rohreihen bleiben vollständig.
  const zustaende = zustaendeFuerVerlauf(Object.keys(by_condition), ['N', 'U']);
  return {
    currency, by_condition,
    history_new: historyNew, history_used: historyUsed,
    chart: buildChart(zustaende.map(c => ({ name: c, rows: c === 'U' ? historyUsed : historyNew }))),
  };
}

export async function getPartPriceHistory(uidWahl: Sicht | number | number[], partNumber: string, colorId: number, currency: string) {
  const uid = await blickfeldAus(uidWahl);
  // Preise liegen unter BrickLink-Nummer und -Farbe, Erfassungen unter denen
  // des Benutzers — die beiden Schlüsselräume dürfen nicht gemischt werden.
  // Ausführlich: docs/begruendungen/src/finanzen/priceHistory.ts.md#getpartpricehistory-blnummer
  const blNummer = await resolveBlPartNumber(partNumber, Array.isArray(uid) ? uid[0] ?? null : uid);
  const blFarbe  = await resolveBlColorId(colorId);
  const nummern  = [...new Set([blNummer, partNumber])];
  return manualPriceHistory(uid, currency,
    'part_price_history', 'part_price_cache', 'part_acquisitions',
    'part_number = ANY($1) AND color_id = $2', [nummern, blFarbe],
    'part_number = $1 AND color_id = $2', [partNumber, colorId]);
}

// Ausführlich: docs/begruendungen/src/finanzen/priceHistory.ts.md#getminifigpricehistory
export async function getMinifigPriceHistory(uidWahl: Sicht | number | number[], figNumber: string, currency: string) {
  const uid = await blickfeldAus(uidWahl);
  const nummern = await preisNummernFuerFigur(uid, figNumber);
  return manualPriceHistory(uid, currency,
    'minifig_price_history', 'minifig_price_cache', 'minifig_acquisitions',
    'fig_number = ANY($1)', [nummern],
    // Die Erfassungen tragen nur die Nummer des Benutzers.
    'fig_number = $1', [figNumber]);
}

/** Die eigene und, falls hinterlegt, die BrickLink-Nummer; doppelte fallen weg.
 * Ausführlich: docs/begruendungen/src/finanzen/priceHistory.ts.md#preisnummernfuerfigur */
async function preisNummernFuerFigur(uid: number | number[], figNumber: string): Promise<string[]> {
  const bl = await blNummerVon('fig', figNumber, uid);
  return [...new Set([figNumber, ...(bl ? [bl] : [])])];
}

/** @returns Anzahl entfernter Zeilen
 * Ausführlich: docs/begruendungen/src/finanzen/priceHistory.ts.md#purgealtepreise */
export async function purgeAltePreise(): Promise<number> {
  const tage = konfig().preisverlaufTage;
  if (tage <= 0) return 0;
  const r = await repo.loescheAltenVerlauf(String(tage)).catch(meldeUndLiefere('preisverlauf:aufraeumen', { changes: 0 }));
  return r?.changes || 0;
}

