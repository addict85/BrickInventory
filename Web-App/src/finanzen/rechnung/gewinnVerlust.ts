
import { blickfeldAus, type Sicht } from '../../haushalt/haushalt';
import { getGlobalSetting, getSetting } from '../../einstellungen/settings';
import { valueSet, valueAcquisitionRows, weightedPurchase, entwicklungProzent, kachelWerte } from '../setValue';
import { effectiveCondition } from './zustand';
import { computeMinifigsValuation, computePartsValuation } from './bewertung';
import type { Blickfeld } from './preise';
import { zaehle } from './abfragen';
import type { ladeSetErfassungen } from '../repository/erfassungen';
import { aufRappen, inZehntel4, summeAus } from '../../infra/geld';
import type * as repo from '../repository/gewinnVerlust';
import { finanzenBereich } from '../prozess';

type PnlSet = Awaited<ReturnType<typeof repo.setsMitErfassungen>>[number];
type Erfassung = Awaited<ReturnType<typeof ladeSetErfassungen>>[number];
/** Je Set: Marktpreis jetzt und zuerst bekannt, Kaufpreis und Menge aus den Erfassungen. */
type Marktwerte = { preis: Map<string, number>; erster: Map<string, number>; kauf: Map<string, number>; menge: Map<string, number> };

/** avg_price zuerst; qty_avg_price nur als Rückfall. */
const preisAus = (r: { avg_price?: unknown; qty_avg_price?: unknown } | undefined) =>
  parseFloat(String(r?.avg_price || 0)) || parseFloat(String(r?.qty_avg_price || 0)) || 0;

/** Das Ausweichen auf den anderen Zustand steckt in valueSet() (priceFor). */
function preiseDesSets(sn: string, jeSchluessel: Map<string, { avg_price?: unknown; qty_avg_price?: unknown }>) {
  const aus = new Map<string, number>();
  for (const cond of ['N', 'U']) {
    const v = preisAus(jeSchluessel.get(`${sn}|${cond}`));
    if (v > 0) aus.set(`${sn}|${cond}`, v);
  }
  return aus;
}

/** Je Erfassung mit dem Preis IHRES Zustands, erst danach verdichten — dieselbe
 * Rechnung wie im Finanzen-Reiter. Ungerundet; gerundet wird in der Antwort. */
async function setMarktwerte(sets: PnlSet[], jeSet: Map<string, Erfassung[]>, currency: string, ttl: number): Promise<Marktwerte> {
  const w: Marktwerte = { preis: new Map(), erster: new Map(), kauf: new Map(), menge: new Map() };
  const nummern = sets.map(s => s.set_number);
  if (!nummern.length) return w;
  const [aktuell, verlauf] = await Promise.all([
    finanzenBereich().gewinnVerlust.frischeMarktpreise(nummern, currency, ttl), finanzenBereich().gewinnVerlust.letzteMarktpreiseAusVerlauf(nummern, currency)]);
  type Preiszeile = { set_number: string; condition: string; avg_price?: unknown; qty_avg_price?: unknown };
  const nachSchluessel = (rows: Preiszeile[]) => new Map(rows.map(r => [`${r.set_number}|${r.condition}`, r]));
  const jetzt = nachSchluessel(aktuell), zuerst = nachSchluessel(verlauf);
  for (const set of sets) {
    const acqs = jeSet.get(set.set_number) || [];
    const zustand = effectiveCondition(set), preise = preiseDesSets(set.set_number, jetzt);
    const cur  = valueSet(set.set_number, acqs, preise, zustand, set.quantity || 1);
    const hist = valueSet(set.set_number, acqs, preiseDesSets(set.set_number, zuerst), zustand, set.quantity || 1);
    if (cur.unit_z)  w.preis.set(set.set_number, cur.unit_z / 10000);
    if (hist.unit_z) w.erster.set(set.set_number, hist.unit_z / 10000);
    const kauf = weightedPurchase(valueAcquisitionRows(set.set_number, acqs, preise));
    if (kauf != null) w.kauf.set(set.set_number, kauf);
    w.menge.set(set.set_number, cur.quantity);
  }
  return w;
}

/** EIN Kostenpfad. Fehlt der Kaufpreis, ist er unbekannt (null), nicht 0 — sonst
 * stünde ein Set ohne Preis als reiner Gewinn da. Ohne Kaufpreis ist der erste
 * bekannte Preis die Basis. */
function pnlSetZeile(set: PnlSet, w: Marktwerte) {
  const sn = set.set_number;
  const currentPrice = w.preis.get(sn) || 0;
  const kauf = w.kauf.get(sn);
  const hasCost = kauf != null, purchasePrice = kauf ?? 0;
  const qty = w.menge.get(sn) || set.quantity || 1;
  const pnlAbs = hasCost ? (currentPrice - purchasePrice) * qty : null;
  const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
  const baselinePrice = hasCost ? purchasePrice : (w.erster.get(sn) ?? null);
  const baselinePnlPct = hasCost || w.erster.has(sn) ? entwicklungProzent(baselinePrice, currentPrice) : null;
  return {
    set_number: sn, name: set.name, year: set.year, image_local: set.image_local, image_url: set.image_url,
    quantity: qty, current_price: currentPrice, purchase_price: hasCost ? purchasePrice : null,
    condition: effectiveCondition(set), baseline_price: baselinePrice, added_at: set.added_at,
    pnl_abs: pnlAbs === null ? null : aufRappen(inZehntel4(pnlAbs) ?? 0).toFixed(2),
    pnl_pct: pnlPct?.toFixed(1) ?? null,
    baseline_pnl_pct: baselinePnlPct?.toFixed(1) ?? null,
    // Die Textfelder bleiben für ältere Clients.
    pnl_betrag: pnlAbs === null ? null : aufRappen(inZehntel4(pnlAbs) ?? 0),
    pnl_prozent: pnlPct === null ? null : Number(pnlPct.toFixed(1)),
    baseline_pnl_prozent: baselinePnlPct === null ? null : Number(baselinePnlPct.toFixed(1)),
  };
}

/** Teil oder Figur: dieselbe Zeile, nur mit Kauf- und Marktpreis. */
function postenZeile(p: { quantity?: number | null; avg_price?: unknown; purchase_price?: unknown }) {
  const qty = p.quantity || 1;
  const currentPrice = parseFloat(String(p.avg_price || 0));
  const hasCost = p.purchase_price != null;
  const purchasePrice = parseFloat(String(p.purchase_price || 0));
  const pnlPct = hasCost ? entwicklungProzent(purchasePrice, currentPrice) : null;
  return { purchase_price: hasCost ? purchasePrice : null, current_price: currentPrice, quantity: qty, pnl_pct: pnlPct?.toFixed(1) ?? null };
}

/** In Zehntausendsteln summiert, erst am Ende auf Rappen gerundet. */
const kaufsumme = (rs: Array<{ purchase_price: number | null; quantity: number }>) =>
  summeAus(rs.map(r => ({ preis: r.purchase_price || 0, menge: r.quantity || 1 })));

export async function computePnl(viewerId: number, idsWahl: Sicht | Blickfeld) {
  // Zwei Grössen: viewerId — wessen EINSTELLUNGEN gelten; ids — WESSEN DATEN
  // gerechnet werden. Mit dem Filter „Unterkonten" fehlt viewerId in ids.
  const uids = await blickfeldAus(idsWahl);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'), getGlobalSetting('price_cache_ttl', '24')]);
  const sets = await finanzenBereich().gewinnVerlust.setsMitErfassungen(uids);
  // Aus den Erfassungen, damit Galerie, Detail und Finanzen dieselben Zahlen zeigen.
  const acqRows = sets.length ? await finanzenBereich().erfassungen.ladeSetErfassungen(uids, currency) : [];
  const jeSet = new Map<string, Erfassung[]>();
  for (const a of acqRows) { const l = jeSet.get(a.set_number); if (l) l.push(a); else jeSet.set(a.set_number, [a]); }
  const werte = await setMarktwerte(sets, jeSet, currency, Math.max(1, parseInt(ttlHours)));

  const setResults = sets.map(s => pnlSetZeile(s, werte));
  const kachel = kachelWerte(setResults);
  const [partsVal, figsVal] = await Promise.all([computePartsValuation(viewerId, uids), computeMinifigsValuation(viewerId, uids)]);
  const partsResults = partsVal.parts.map(postenZeile), figsResults = figsVal.figs.map(postenZeile);

  const alleZeilen = [...setResults, ...partsResults, ...figsResults];
  const totalPurchase = aufRappen([setResults, partsResults, figsResults].reduce((z, rs) => z + (inZehntel4(kaufsumme(rs)) ?? 0), 0));
  const totalCurrent = summeAus(alleZeilen.map(r => ({ preis: r.current_price || 0, menge: r.quantity || 1 })));
  const vergleichbar = vergleichbareSummen(alleZeilen);
  const totalPnlPct = gesamtGuvProzent(alleZeilen);
  return {
    currency, sets: setResults.map(r => ({ ...r, ...kachel.get(r.set_number) })),
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
      grand_total: totalCurrent.toFixed(2),
      sets_purchase: kaufsumme(setResults).toFixed(2),
      parts_purchase: kaufsumme(partsResults).toFixed(2),
      figs_purchase: kaufsumme(figsResults).toFixed(2),
      ...basisDerKennzahlen(alleZeilen),
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

