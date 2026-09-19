/**
 * Gewinn und Verlust — was der Bestand gekostet hat und was er heute wert ist.
 *
 * ── Warum das eine eigene Datei ist (Nachtrag 171) ──────────────────────────
 *
 * Marcos Frage nach Architektur und Codequalitaet hatte utils/financeCalc.ts
 * mit 1529 Zeilen als groessten Posten. Die Datei trug DREI Aufgaben:
 *
 *   1. Preisbeschaffung — BrickLink abfragen, zwischenspeichern, das
 *      Anfragekontingent verwalten
 *   2. Bewertung — was ist der Bestand heute wert
 *   3. Gewinn und Verlust — was hat er gekostet, was hat er gebracht
 *
 * Gemessen haengen sie nur in EINE Richtung zusammen: Die Bewertung braucht
 * die Preise, die G&V braucht davon gar nichts ausser einem Helfer. Wer am
 * Anfragekontingent etwas aendert, sollte nicht in derselben Datei stehen wie
 * die Gewinnrechnung.
 *
 * Die Aufteilung ist rein raeumlich: Kein Verhalten hat sich geaendert, und
 * utils/financeCalc.ts reicht alles weiterhin durch — keine einzige
 * Aufrufstelle musste angefasst werden.
 */

import * as db from '../../db/database';
import { asIds } from '../household';
import { getSetting, getGlobalSetting } from '../settings';
import { valueSet, valueAcquisitionRows, weightedPurchase, PNL_EPS } from '../setValue';
import { effectiveCondition } from './zustand';
import { computeMinifigsValuation, computePartsValuation } from './bewertung';
import type { Blickfeld } from './preise';
import { ladeSetErfassungen } from './abfragen';

// ── GET /api/finance/parts-valuation ─────────────────────────────────────────────
async function computePnl(viewerId: number, ids: Blickfeld) {
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
    `SELECT s.set_number, s.name, s.year, s.quantity, s.image_local, s.image_url, s.added_at, s.condition,
            -- Ø-Kaufpreis pro Stück aus der Erfassungs-Historie (Fallback: alter
            -- Einzelwert). Frontend/Apps rechnen weiterhin purchase_price × quantity,
            -- die Summe stimmt damit auch bei unterschiedlich teuren Erfassungen.
            COALESCE(a.total_price / NULLIF(a.total_qty, 0), s.purchase_price) AS purchase_price,
            -- acq_count/used_count fehlten hier komplett — effectiveCondition()
            -- weiter unten braucht sie, um den Zustand aus den Erfassungen
            -- abzuleiten. Ohne sie war set.acq_count/used_count immer
            -- undefined, effectiveCondition() fiel IMMER auf sets.condition
            -- zurück, egal was die Erfassungen tatsächlich sagten. Für ein Set
            -- mit gemischten Erfassungen (z. B. 1× Neu, 1× Gebraucht) oder
            -- einem veralteten sets.condition zeigte der P&L-Pfad — und damit
            -- die Galerie-Kachel und der Detail-Dialog — dadurch den falschen
            -- Marktpreis, während computeSetsValuation() (Finanzen-Reiter)
            -- längst korrekt über die Erfassungen entschied. Zwei Wahrheiten
            -- für denselben Zustand.
            COALESCE(a.acq_count, 0)  AS acq_count,
            COALESCE(a.used_count, 0) AS used_count
     FROM sets s
     LEFT JOIN (
       SELECT user_id, set_number,
              SUM(COALESCE(purchase_price, 0) * quantity) AS total_price,
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
  const acqRows = setNumbers.length ? await ladeSetErfassungen(uids) : [];
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const list = acqBySet.get(a.set_number);
    if (list) list.push(a); else acqBySet.set(a.set_number, [a]);
  }
  if (setNumbers.length) {
    // DIESE Abfrage speist die P&L-Antwort und damit den in der Galerie und im
    // Detail-Dialog angezeigten „Marktpreis". Sie hatte zwei Fehler, die beim
    // ersten Preis-Fix in routes/ behoben wurden, hier aber stehen blieben:
    //
    //   1. Sie las nur qty_avg_price. Die Zuweisungszeile darunter griff auf
    //      r.avg_price zu — das war undefined, also gewann immer der
    //      mengengewichtete Schnitt.
    //   2. ORDER BY (qty_avg_price > 0) DESC, (condition = …) DESC stellte
    //      „hat einen Preis" VOR „passender Zustand". Mit DISTINCT ON gewann
    //      damit der Gebraucht-Preis, auch für ein neues Set.
    //
    // Neu: beide Zustände holen und je Set nach dessen eigenem Zustand wählen —
    // der globale Standardzustand passt nicht für eine gemischte Sammlung.
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
    //
    // Vorher galt hier EIN Zustand fürs ganze Set: eine einzige
    // Gebraucht-Erfassung liess den Marktpreis aller Exemplare auf den
    // Gebrauchtpreis fallen. Galerie-Kachel und Detail-Dialog lesen genau
    // diese Antwort — die Sammlung wurde damit schlagartig weniger wert, ohne
    // dass sich am Markt etwas geändert hätte.
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
      if (cur.unit_price)  priceMap.set(set.set_number, cur.unit_price);
      if (hist.unit_price) firstHistMap.set(set.set_number, hist.unit_price);
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
    // Kaufpreis aus den Erfassungen; die sets-Spalte nur noch als Rückfall für
    // Altbestände ohne Erfassungen.
    const acqPurchase = purchaseMap.get(set.set_number);
    const hasCost = acqPurchase != null || set.purchase_price != null;  // 0 zählt als erfasst
    const purchasePrice = acqPurchase != null ? acqPurchase : parseFloat(set.purchase_price || 0);
    const qty = qtyMap.get(set.set_number) || set.quantity || 1;
    const pnlAbs = hasCost ? (currentPrice - purchasePrice) * qty : null;
    const pnlPct = (hasCost && currentPrice > 0) ? ((currentPrice - purchasePrice) / Math.max(purchasePrice, PNL_EPS)) * 100 : null;
    // First price recorded = baseline if no purchase_price (0 zählt als erfasst)
    const baselineHas = hasCost || firstHistMap.has(set.set_number);
    const baselinePrice = hasCost ? purchasePrice : (firstHistMap.get(set.set_number) || 0);
    const baselinePnlPct = (baselineHas && currentPrice > 0) ? ((currentPrice - baselinePrice) / Math.max(baselinePrice, PNL_EPS)) * 100 : null;
    return {
      set_number: set.set_number, name: set.name, year: set.year,
      image_local: set.image_local, image_url: set.image_url,
      quantity: qty, current_price: currentPrice, purchase_price: purchasePrice,
      condition: setCondition, baseline_price: baselinePrice, added_at: set.added_at,
      pnl_abs: pnlAbs?.toFixed(2) ?? null,
      pnl_pct: pnlPct?.toFixed(1) ?? null,
      baseline_pnl_pct: baselinePnlPct?.toFixed(1) ?? null,
    };
  });

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
    const pnlPct = (hasCost && currentPrice > 0) ? ((currentPrice - purchasePrice) / Math.max(purchasePrice, PNL_EPS)) * 100 : null;
    return { purchase_price: purchasePrice, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });
  const figsResults = figsVal.figs.map(f => {
    const qty = f.quantity || 1;
    const currentPrice = parseFloat(f.avg_price || 0);
    const hasCost = f.purchase_price != null;
    const purchasePrice = parseFloat(f.purchase_price || 0);
    const pnlPct = (hasCost && currentPrice > 0) ? ((currentPrice - purchasePrice) / Math.max(purchasePrice, PNL_EPS)) * 100 : null;
    return { purchase_price: purchasePrice, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });

  // Portfolio totals — Sets + manuell erfasste Teile + Minifiguren zusammen
  const totalPurchase =
    setResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0) +
    partsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0) +
    figsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0);
  const totalCurrent =
    setResults.reduce((s,r) => s + (r.current_price||0)*(r.quantity||1), 0) +
    partsResults.reduce((s,r) => s + (r.current_price||0)*(r.quantity||1), 0) +
    figsResults.reduce((s,r) => s + (r.current_price||0)*(r.quantity||1), 0);
  const totalPnlPct = totalPurchase > 0 ? ((totalCurrent - totalPurchase) / totalPurchase * 100).toFixed(1) : null;

  return {
    currency, sets: setResults,
    totals: {
      purchase: totalPurchase.toFixed(2), current: totalCurrent.toFixed(2), pnl_pct: totalPnlPct,
      /**
       * Der Gesamtwert des Portfolios — Sets + manuell erfasste Teile +
       * Minifiguren.
       *
       * ── Warum ausdrücklich (Nachtrag 145) ────────────────────────────────
       *
       * Marcos Frage: „Ist sichergestellt, dass die ganze Logik im Server
       * zentral ist und beide Clients nur rendern?"
       *
       * Für diese Zahl war sie es NICHT: Webapp und Android addierten je selbst
       * `sets.totals.avg + parts.total_value + figs.total_value`. Die Regel
       * „was zählt zum Gesamtwert" stand damit an drei Stellen.
       *
       * Derselbe Wert steckte schon in `current` — der wird aber aus den
       * Preisen JE ZEILE gebildet und ist damit die belastbarere Quelle als
       * eine Addition dreier gerundeter Endsummen. Er bekommt hier nur einen
       * Namen, der sagt, wofür er da ist. Kein zusätzlicher Abruf: Beide
       * Clients holen /finance/pnl ohnehin.
       */
      grand_total: totalCurrent.toFixed(2),
      sets_purchase: setResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0).toFixed(2),
      parts_purchase: partsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0).toFixed(2),
      figs_purchase: figsResults.reduce((s,r) => s + (r.purchase_price||0)*(r.quantity||1), 0).toFixed(2),
    },
  };
}

export { computePnl };
