
import { asIds, blickfeldAus, type Sicht } from '../../haushalt/haushalt';
import { getGlobalSetting, getSetting } from '../../einstellungen/settings';
import { valueSet, valueAcquisitionRows, weightedPurchase, entwicklungProzent, kachelWerte } from '../setValue';
import { effectiveCondition } from './zustand';
import { computeMinifigsValuation, computePartsValuation } from './bewertung';
import type { Blickfeld } from './preise';
import { zaehle } from './abfragen';
import { ladeSetErfassungen } from '../repository/erfassungen';
import { aufRappen, inZehntel4, summeAus } from '../../infra/geld';
import * as repo from '../repository/gewinnVerlust';

export async function computePnl(viewerId: number, idsWahl: Sicht | Blickfeld) {
  const ids = await blickfeldAus(idsWahl);
  // Zwei Grössen: viewerId — wessen EINSTELLUNGEN gelten; ids — WESSEN DATEN
  // gerechnet werden. Mit dem Filter „Unterkonten" fehlt viewerId in ids.
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);

  const sets = await repo.setsMitErfassungen(uids);

  // Je eine Abfrage für alle Sets statt zwei je Set.
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const priceMap = new Map(), firstHistMap = new Map();
  // Aus den Erfassungen, damit Galerie, Detail und Finanzen dieselben Zahlen zeigen.
  const purchaseMap = new Map(), qtyMap = new Map();
  const acqRows = setNumbers.length ? await ladeSetErfassungen(uids, String(currency)) : [];
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const list = acqBySet.get(a.set_number);
    if (list) list.push(a); else acqBySet.set(a.set_number, [a]);
  }
  if (setNumbers.length) {
    // Diese Abfrage speist den angezeigten „Marktpreis" in Galerie und Detail.
    // Ausführlich: docs/begruendungen/src/finanzen/rechnung/gewinnVerlust.ts.md#computepnl
    const [cachedRows, firstRows] = await Promise.all([
      repo.frischeMarktpreise(setNumbers, currency, ttl),
      repo.letzteMarktpreiseAusVerlauf(setNumbers, currency),
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

    // Je Erfassung mit dem Preis IHRES Zustands, erst danach verdichten —
    // dieselbe Rechnung wie im Finanzen-Reiter.
    for (const set of sets) {
      const acqs = acqBySet.get(set.set_number) || [];
      const fallbackCond = effectiveCondition(set);
      // Das Ausweichen auf den anderen Zustand steckt in valueSet() (priceFor).
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
      const rows = valueAcquisitionRows(set.set_number, acqs, asPriceMap(cacheByKey));
      const purchase = weightedPurchase(rows);
      if (purchase != null) purchaseMap.set(set.set_number, purchase);
      qtyMap.set(set.set_number, cur.quantity);
    }
  }

  const setResults = sets.map(set => {
    const setCondition = effectiveCondition(set);
    const currentPrice = priceMap.get(set.set_number) || 0;
    // EIN Kostenpfad. Fehlt der Kaufpreis, ist er unbekannt (null), nicht 0 —
    // sonst stünde ein Set ohne Preis als reiner Gewinn da. 0 zählt als erfasst.
    const acqPurchase = purchaseMap.get(set.set_number);
    const hasCost = acqPurchase != null;
    const purchasePrice = acqPurchase ?? 0;
    const qty = qtyMap.get(set.set_number) || set.quantity || 1;
    const pnlAbs = hasCost ? (currentPrice - purchasePrice) * qty : null;
    const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
    // Ohne Kaufpreis ist der erste bekannte Preis die Basis.
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
      // Die Textfelder bleiben für ältere Clients.
      pnl_betrag: pnlAbs === null ? null : aufRappen(inZehntel4(pnlAbs) ?? 0),
      pnl_prozent: pnlPct === null ? null : Number(pnlPct.toFixed(1)),
      baseline_pnl_prozent: baselinePnlPct === null ? null : Number(baselinePnlPct.toFixed(1)),
    };
  });
  const kachel = kachelWerte(setResults);
  const setZeilen = setResults.map(r => ({ ...r, ...kachel.get(r.set_number) }));

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
    return { purchase_price: hasCost ? purchasePrice : null, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });
  const figsResults = figsVal.figs.map(f => {
    const qty = f.quantity || 1;
    const currentPrice = parseFloat(f.avg_price || 0);
    const hasCost = f.purchase_price != null;
    const purchasePrice = parseFloat(f.purchase_price || 0);
    const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
    return { purchase_price: hasCost ? purchasePrice : null, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
  });

  // In Zehntausendsteln summiert, erst am Ende auf Rappen gerundet.
  const kauf = (rs: Array<{ purchase_price: number | null; quantity: number }>) =>
    summeAus(rs.map(r => ({ preis: r.purchase_price || 0, menge: r.quantity || 1 })));
  const totalPurchase = aufRappen((inZehntel4(kauf(setResults)) ?? 0) + (inZehntel4(kauf(partsResults)) ?? 0) + (inZehntel4(kauf(figsResults)) ?? 0));
  const totalCurrent = summeAus([...setResults, ...partsResults, ...figsResults]
    .map(r => ({ preis: r.current_price || 0, menge: r.quantity || 1 })));
  const alleZeilen = [...setResults, ...partsResults, ...figsResults];
  const vergleichbar = vergleichbareSummen(alleZeilen);
  const totalPnlPct = gesamtGuvProzent(alleZeilen);
  const basis = basisDerKennzahlen(alleZeilen);

  return {
    currency, sets: setZeilen,
    totals: {
      purchase: totalPurchase.toFixed(2), current: totalCurrent.toFixed(2), pnl_pct: totalPnlPct,
      pnl_prozent: totalPnlPct === null ? null : Number(totalPnlPct),
      kaufpreise_fremde_waehrung: zaehle(acqRows, 'kaufpreis_fremd')
        + (partsVal.kaufpreise_fremde_waehrung ?? 0) + (figsVal.kaufpreise_fremde_waehrung ?? 0),
      kaufpreise_umgerechnet: zaehle(acqRows, 'kaufpreis_umgerechnet')
        + (partsVal.kaufpreise_umgerechnet ?? 0) + (figsVal.kaufpreise_umgerechnet ?? 0),
      // Aus denselben Posten wie pnl_pct: Aus allen gerechnet zählte jeder Posten
      // ohne Marktpreis als Verlust.
      pnl_purchase: vergleichbar.kauf.toFixed(2), pnl_current: vergleichbar.markt.toFixed(2),
      // Sets + manuelle Teile + Minifiguren.
      // Ausführlich: docs/begruendungen/src/finanzen/rechnung/gewinnVerlust.ts.md#computepnl-3
      grand_total: totalCurrent.toFixed(2),
      sets_purchase: kauf(setResults).toFixed(2),
      parts_purchase: kauf(partsResults).toFixed(2),
      figs_purchase: kauf(figsResults).toFixed(2),
      ...basis,
    },
  };
}

/** Nur über Posten mit Kaufpreis UND Marktpreis: Ein fehlender Marktpreis ist
 * kein Wert 0; mitgezählt ergäbe er −100 %. Ein Geschenk (Kaufpreis 0) zählt mit.
 * @returns null, wenn der Einstand dieser Posten 0 ist */
export function gesamtGuvProzent(zeilen: GuvZeile[]): string | null {
  const { kauf, markt } = vergleichbareSummen(zeilen);
  return kauf > 0 ? ((markt - kauf) / kauf * 100).toFixed(1) : null;
}

type GuvZeile = { purchase_price: number | null; current_price: number; quantity: number };

export function vergleichbareSummen(zeilen: GuvZeile[]): { kauf: number; markt: number } {
  let kauf = 0, markt = 0;
  for (const z of zeilen) {
    const m = z.current_price || 0, n = z.quantity || 1;
    if (z.purchase_price != null && z.purchase_price >= 0 && m > 0) { kauf += z.purchase_price * n; markt += m * n; }
  }
  return { kauf, markt };
}

/** Einstand, Marktwert und G/V der Finanzkarten über dieselben Posten, dazu was fehlt.
 * So gilt immer Einstand + G/V = Marktwert, und die Karte nennt die ausgelassenen Posten. */
export function basisDerKennzahlen(zeilen: GuvZeile[]) {
  const { kauf, markt } = vergleichbareSummen(zeilen);
  let ohneMarkt = 0, ohneMarktKauf = 0, ohneKauf = 0, ohneKaufMarkt = 0;
  for (const z of zeilen) {
    const n = z.quantity || 1;
    if (!(z.current_price > 0)) { ohneMarkt++; ohneMarktKauf += (z.purchase_price || 0) * n; }
    else if (z.purchase_price == null) { ohneKauf++; ohneKaufMarkt += z.current_price * n; }
  }
  return {
    positionen: zeilen.length,
    positionen_bewertet: zeilen.length - ohneMarkt - ohneKauf,
    positionen_ohne_marktpreis: ohneMarkt,
    positionen_ohne_kaufpreis: ohneKauf,
    basis_einstand: kauf.toFixed(2),
    basis_marktwert: markt.toFixed(2),
    basis_guv_betrag: (markt - kauf).toFixed(2),
    ohne_marktpreis_einstand: ohneMarktKauf.toFixed(2),
    ohne_kaufpreis_marktwert: ohneKaufMarkt.toFixed(2),
  };
}

