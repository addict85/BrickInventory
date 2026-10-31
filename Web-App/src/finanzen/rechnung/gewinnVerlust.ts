/**
 * Gewinn und Verlust — was der Bestand gekostet hat und was er heute wert ist.
 * Ausführlich: docs/begruendungen/src/finanzen/rechnung/gewinnVerlust.ts.md#abschnitt
 */

import * as db from '../../../db/database';
import { asIds } from '../../haushalt/haushalt';
import { getGlobalSetting } from '../../konto/settings';
import { getSetting } from '../../konto/settings';
import { valueSet, valueAcquisitionRows, weightedPurchase, entwicklungProzent, kachelWerte } from '../setValue';
import { effectiveCondition } from './zustand';
import { computeMinifigsValuation, computePartsValuation } from './bewertung';
import type { Blickfeld } from './preise';
import { ladeSetErfassungen, zaehle } from './abfragen';
import { aufRappen, inZehntel4, summeAus } from '../../infra/geld';

// ── GET /api/finance/parts-valuation ─────────────────────────────────────────────
export async function computePnl(viewerId: number, ids: Blickfeld) {
  // ZWEI Grössen, bewusst getrennt:
  //   viewerId — wessen EINSTELLUNGEN gelten (Währung, Cache-Dauer, Preisart)
  //   ids      — WESSEN DATEN gerechnet werden (Blickfeld, ggf. gefiltert)
  //
  // Sie fallen auseinander, sobald der Kontofilter auf „Unterkonten" steht:
  // Dann enthält ids das fragende Konto gar nicht. Die Einstellungen mit
  // ids[0] zu holen hiesse dort, die Währung eines Kindes zu benutzen.
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);

  const sets = await db.all(
    `SELECT s.set_number, c.name, c.year,
            -- Menge aus den Erfassungen (Gruppierung a unten), kein zweiter JOIN.
            COALESCE(a.total_qty, 0)::int AS quantity,
            c.image_local, c.image_url, s.added_at,
            -- effectiveCondition() leitet den Zustand aus diesen Zählern ab.
            COALESCE(a.acq_count, 0)  AS acq_count,
            COALESCE(a.used_count, 0) AS used_count
     -- Name, Jahr und Bilder stehen seit Migration 0033 in set_catalog.
     FROM sets s
     LEFT JOIN set_catalog c ON c.set_number = s.set_number
     LEFT JOIN (
       SELECT user_id, set_number,
              SUM(quantity) AS total_qty,
              COUNT(*)                                AS acq_count,
              COUNT(*) FILTER (WHERE condition = 'U')  AS used_count
       FROM set_acquisitions GROUP BY user_id, set_number
     ) a ON a.user_id = s.user_id AND a.set_number = s.set_number
     WHERE s.user_id = ANY($1)`, [uids]);

  // Statt 2 Queries pro Set: aktuelle Cache-Preise und ältester History-Eintrag
  // für ALLE Sets in je einer Batch-Query (nutzt UNIQUE-Index bzw. idx_price_history_set).
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const priceMap = new Map(), firstHistMap = new Map();
  // Kaufpreis und Menge kommen jetzt ebenfalls aus den Erfassungen, damit
  // Galerie/Detail und der Finanzen-Reiter dieselben Zahlen zeigen.
  const purchaseMap = new Map(), qtyMap = new Map();
  const acqRows = setNumbers.length ? await ladeSetErfassungen(uids, String(currency)) : [];
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const list = acqBySet.get(a.set_number);
    if (list) list.push(a); else acqBySet.set(a.set_number, [a]);
  }
  if (setNumbers.length) {
    // DIESE Abfrage speist die P&L-Antwort und damit den in der Galerie und im
    // Detail-Dialog angezeigten „Marktpreis". Sie hatte zwei Fehler, die beim
    // ersten Preis-Fix in routes/ behoben wurden, hier aber stehen blieben:
    // Ausführlich: docs/begruendungen/src/finanzen/rechnung/gewinnVerlust.ts.md#computepnl
    const [cachedRows, firstRows] = await Promise.all([
      db.all(
        `SELECT set_number, condition, avg_price, qty_avg_price FROM price_cache
         WHERE set_number = ANY($1) AND condition IN ('U','N') AND currency_code=$2
           AND fetched_at > NOW() - make_interval(hours => $3)`,
        [setNumbers, currency, ttl]),
      db.all(
        `SELECT DISTINCT ON (set_number, condition) set_number, condition, avg_price, qty_avg_price
         FROM price_history
         WHERE set_number = ANY($1) AND currency_code=$2 AND condition IN ('U','N')
         ORDER BY set_number, condition, recorded_at ASC`,
        [setNumbers, currency]),
    ]);

    /** avg_price zuerst; qty_avg_price nur als Rückfall. */
    const val = (r: { avg_price?: any; qty_avg_price?: any } | undefined) =>
      parseFloat(r?.avg_price || 0) || parseFloat(r?.qty_avg_price || 0) || 0;
    const byKey = (rows: any[]) => {
      const m = new Map();
      for (const r of rows) m.set(`${r.set_number}|${r.condition}`, r);
      return m;
    };
    const cacheByKey = byKey(cachedRows), histByKey = byKey(firstRows);

    // Je Erfassung mit dem Preis IHRES Zustands bewerten und erst danach
    // verdichten — dieselbe Rechnung wie im Finanzen-Reiter
    // (utils/acquisitionValue.ts).
    // Ausführlich: docs/begruendungen/src/finanzen/rechnung/gewinnVerlust.ts.md#computepnl-2
    for (const set of sets) {
      const acqs = acqBySet.get(set.set_number) || [];
      const fallbackCond = effectiveCondition(set);
      // Map in der Form, die valueSet() erwartet — das Ausweichen auf den
      // anderen Zustand steckt dort schon drin (priceFor).
      const asPriceMap = (m: Map<string, any>) => {
        const out = new Map();
        for (const cond of ['N', 'U']) {
          const v = val(m.get(`${set.set_number}|${cond}`));
          if (v > 0) out.set(`${set.set_number}|${cond}`, v);
        }
        return out;
      };
      const cur  = valueSet(set.set_number, acqs, asPriceMap(cacheByKey), fallbackCond, set.quantity || 1);
      const hist = valueSet(set.set_number, acqs, asPriceMap(histByKey),  fallbackCond, set.quantity || 1);
      // Ungerundet weiterrechnen; gerundet wird erst in der Antwort.
      if (cur.unit_z)  priceMap.set(set.set_number, cur.unit_z / 10000);
      if (hist.unit_z) firstHistMap.set(set.set_number, hist.unit_z / 10000);
      // Kaufpreis ebenfalls aus den Erfassungen (nur die mit erfasstem Preis).
      const rows = valueAcquisitionRows(set.set_number, acqs, asPriceMap(cacheByKey));
      const purchase = weightedPurchase(rows);
      if (purchase != null) purchaseMap.set(set.set_number, purchase);
      qtyMap.set(set.set_number, cur.quantity);
    }
  }

  const setResults = sets.map(set => {
    const setCondition = effectiveCondition(set);
    const currentPrice = priceMap.get(set.set_number) || 0;
    // EIN Kostenpfad: der mengengewichtete Kaufpreis der Erfassungen mit Preis
    // in dieser Währung. Fehlt er, ist der Kaufpreis unbekannt (null) — nicht
    // 0, sonst stünde ein Set ohne Preis als reiner Gewinn da. 0 zählt als erfasst.
    const acqPurchase = purchaseMap.get(set.set_number);
    const hasCost = acqPurchase != null;
    const purchasePrice = acqPurchase ?? 0;
    const qty = qtyMap.get(set.set_number) || set.quantity || 1;
    const pnlAbs = hasCost ? (currentPrice - purchasePrice) * qty : null;
    const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
    // First price recorded = baseline if no purchase_price (0 zählt als erfasst)
    const baselineHas = hasCost || firstHistMap.has(set.set_number);
    const baselinePrice = hasCost ? purchasePrice : (firstHistMap.get(set.set_number) ?? null);
    const baselinePnlPct = baselineHas ? entwicklungProzent(baselinePrice, currentPrice) : null;
    return {
      set_number: set.set_number, name: set.name, year: set.year,
      image_local: set.image_local, image_url: set.image_url,
      quantity: qty, current_price: currentPrice, purchase_price: hasCost ? purchasePrice : null,
      condition: setCondition, baseline_price: baselinePrice, added_at: set.added_at,
      pnl_abs: pnlAbs === null ? null : aufRappen(inZehntel4(pnlAbs) ?? 0).toFixed(2),
      pnl_pct: pnlPct?.toFixed(1) ?? null,
      baseline_pnl_pct: baselinePnlPct?.toFixed(1) ?? null,
      // Dieselben Angaben als Zahlen; die Textfelder bleiben für ältere Clients.
      pnl_betrag: pnlAbs === null ? null : aufRappen(inZehntel4(pnlAbs) ?? 0),
      pnl_prozent: pnlPct === null ? null : Number(pnlPct.toFixed(1)),
      baseline_pnl_prozent: baselinePnlPct === null ? null : Number(baselinePnlPct.toFixed(1)),
    };
  });
  // Die Galerie zeigt je Set EINE Kachel: Betrag und G&V fertig vom Server.
  const kachel = kachelWerte(setResults);
  const setZeilen = setResults.map(r => ({ ...r, ...kachel.get(r.set_number) }));

  // Manuell erfasste Teile und Minifiguren fliessen mit ihrem eigenen Kaufpreis
  // (bzw. dem Marktpreis als Ersatz) ebenfalls in die Finanzen-Gesamtsumme ein.
  const [partsVal, figsVal] = await Promise.all([
    computePartsValuation(viewerId, uids),
    computeMinifigsValuation(viewerId, uids),
  ]);

  const partsResults = partsVal.parts.map(p => {
    const qty = p.quantity || 1;
    const currentPrice = parseFloat(p.avg_price || 0);
    const hasCost = p.purchase_price != null;
    const purchasePrice = parseFloat(p.purchase_price || 0);
    const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
    return { purchase_price: purchasePrice, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });
  const figsResults = figsVal.figs.map(f => {
    const qty = f.quantity || 1;
    const currentPrice = parseFloat(f.avg_price || 0);
    const hasCost = f.purchase_price != null;
    const purchasePrice = parseFloat(f.purchase_price || 0);
    const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
    return { purchase_price: purchasePrice, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });

  // Portfolio totals — Sets + manuell erfasste Teile + Minifiguren zusammen,
  // in Zehntausendsteln summiert und erst am Ende auf Rappen gerundet.
  const kauf = (rs: Array<{ purchase_price: number | null; quantity: number }>) =>
    summeAus(rs.map(r => ({ preis: r.purchase_price || 0, menge: r.quantity || 1 })));
  const totalPurchase = aufRappen((inZehntel4(kauf(setResults)) ?? 0) + (inZehntel4(kauf(partsResults)) ?? 0) + (inZehntel4(kauf(figsResults)) ?? 0));
  const totalCurrent = summeAus([...setResults, ...partsResults, ...figsResults]
    .map(r => ({ preis: r.current_price || 0, menge: r.quantity || 1 })));
  const vergleichbar = vergleichbareSummen([...setResults, ...partsResults, ...figsResults]);
  const totalPnlPct = gesamtGuvProzent([...setResults, ...partsResults, ...figsResults]);

  return {
    currency, sets: setZeilen,
    totals: {
      purchase: totalPurchase.toFixed(2), current: totalCurrent.toFixed(2), pnl_pct: totalPnlPct,
      pnl_prozent: totalPnlPct === null ? null : Number(totalPnlPct),
      kaufpreise_fremde_waehrung: zaehle(acqRows, 'kaufpreis_fremd')
        + (partsVal.kaufpreise_fremde_waehrung ?? 0) + (figsVal.kaufpreise_fremde_waehrung ?? 0),
      kaufpreise_umgerechnet: zaehle(acqRows, 'kaufpreis_umgerechnet')
        + (partsVal.kaufpreise_umgerechnet ?? 0) + (figsVal.kaufpreise_umgerechnet ?? 0),
      // Kauf- und Marktwert der Posten, über die pnl_pct rechnet. Ein Betrag
      // neben der Prozentzahl muss aus denselben Posten kommen — aus allen
      // gerechnet zählte jeder Posten ohne Marktpreis als Verlust.
      pnl_purchase: vergleichbar.kauf.toFixed(2), pnl_current: vergleichbar.markt.toFixed(2),
      /**
       * Der Gesamtwert des Portfolios — Sets + manuell erfasste Teile +
       * Minifiguren.
       * Ausführlich: docs/begruendungen/src/finanzen/rechnung/gewinnVerlust.ts.md#computepnl-3
       */
      grand_total: totalCurrent.toFixed(2),
      sets_purchase: kauf(setResults).toFixed(2),
      parts_purchase: kauf(partsResults).toFixed(2),
      figs_purchase: kauf(figsResults).toFixed(2),
    },
  };
}

/**
 * Gesamt-G&V in Prozent — nur über Posten mit Kaufpreis UND Marktpreis. Ein
 * fehlender Marktpreis ist kein Wert 0; mitgezählt ergäbe er −100 %.
 * @returns null, wenn kein Posten beides hat
 */
export function gesamtGuvProzent(zeilen: GuvZeile[]): string | null {
  const { kauf, markt } = vergleichbareSummen(zeilen);
  return kauf > 0 ? ((markt - kauf) / kauf * 100).toFixed(1) : null;
}

type GuvZeile = { purchase_price: number | null; current_price: number; quantity: number };

/** Kauf- und Marktwert der Posten, die beides haben. */
export function vergleichbareSummen(zeilen: GuvZeile[]): { kauf: number; markt: number } {
  let kauf = 0, markt = 0;
  for (const z of zeilen) {
    const k = z.purchase_price || 0, m = z.current_price || 0, n = z.quantity || 1;
    if (k > 0 && m > 0) { kauf += k * n; markt += m * n; }
  }
  return { kauf, markt };
}

