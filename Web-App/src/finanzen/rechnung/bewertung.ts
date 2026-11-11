/** Was der Bestand heute wert ist; steht auf der Preisschicht (preise.ts) und
 * trägt die Gewinnrechnung, nicht umgekehrt. Gelesen wird nur der Preis-Cache:
 * Fehlende Preise holt der Auftrag „preise_nachladen“, nicht die Anfrage. */

import { createHash } from 'node:crypto';
import { logAndContinue } from '../../infra/fehler';
import type * as repo from '../repository/bewertung';
import { haushaltBereich, asIds, type Sicht } from '../../haushalt';
import { getGlobalSetting, getSetting } from '../../einstellungen';
import { resolveImageLocal, proxyImageUrl } from '../../katalog';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct, pnlProzent } from '../setValue';
import { mitVersion } from '../../infra/setNummer';
import {
  DEFAULT_PRICE_CONDITION, parallelLimit, ladeBlNummernVor, ladeTeilepreiseVor, ladeFigurenpreiseVor,
  preisAusVorrat, setPreisAusVorrat, teilSchluessel, type Blickfeld, type PreisDaten,
} from './preise';
import { zaehle } from './abfragen';
import type { ladeSetErfassungen } from '../repository/erfassungen';
import { KEINE_FARBE, zustand } from '../../infra/validate';
import { aufRappen, inZehntel4 } from '../../infra/geld';
import { stelleAuftragEin, type Nutzlast } from '../../auftraege';
import { fehlerText } from '../../infra/fehlerTexte';
import { finanzenBereich } from '../prozess';

type Zustand = 'N' | 'U';
type Posten = Nutzlast<'preise_nachladen'>['posten'][number];
type FigurPreis = PreisDaten & { estimated_from_parts?: true; abdeckung?: number | null };

/** @returns Map key → Erfassungszeilen; key ist `konto|nummer|farbe` bzw. `konto|nummer` */
async function loadManualAcquisitions(uid: Blickfeld, kind: 'part' | 'fig', waehrung: string) {
  // Ein Hauptkonto bewertet den ganzen Haushalt; die Währung ist beim
  // Verknüpfen erzwungen gleich, sonst summierte das zwei Währungen.
  const rows = await finanzenBereich().bewertung.manuelleErfassungen(kind, asIds(uid), waehrung);
  const out = new Map<string, repo.ManuelleErfassung[]>();
  for (const r of rows) {
    const key = kind === 'part' ? `${r.user_id}|${r.part_number}|${r.color_id ?? KEINE_FARBE}` : `${r.user_id}|${r.fig_number}`;
    const list = out.get(key);
    if (list) list.push(r); else out.set(key, [r]);
  }
  return out;
}

function fremdeKaufpreise(jeEintrag: Map<string, Array<{ kaufpreis_fremd?: boolean }>>): number {
  let n = 0;
  for (const zeilen of jeEintrag.values()) n += zeilen.filter(z => z.kaufpreis_fremd).length;
  return n;
}

/** Ein Auftrag je Satz fehlender Preise: Dieselbe Liste stellt keinen zweiten ein. */
async function merkePreiseVor(viewerId: number, waehrung: string, posten: Posten[]): Promise<number> {
  if (!posten.length) return 0;
  const liste = posten.slice(0, 2000);
  const schluessel = 'preise_nachladen:' + createHash('sha256').update(`${viewerId}|${waehrung}|${JSON.stringify(liste)}`).digest('hex').slice(0, 32);
  await stelleAuftragEin('preise_nachladen', { user_id: viewerId, waehrung, posten: liste }, { schluessel, userId: viewerId })
    .catch(logAndContinue('bewertung:preise vormerken'));
  return posten.length;
}

type BewertungsSet = Awaited<ReturnType<typeof repo.setsZurBewertung>>[number];
type SetErfassung = Awaited<ReturnType<typeof ladeSetErfassungen>>[number];
/** Was jede Zeile braucht: Einstellungen des Betrachters und die vorgeladenen Tabellen. */
type Bewertungslage = { ttl: number; pre: Parameters<typeof setPreisAusVorrat>[3]; fehlt: Posten[]; ohneZugang: string | null };

/** Eine Zeile der Bewertung: Je Kaufpreis der Preis SEINES Zustands, verdichtet
 * in valueSet(), damit die Bewertungsregel an EINER Stelle bleibt. */
function bewerteSet(set: BewertungsSet, acqs: SetErfassung[], l: Bewertungslage) {
  // Ohne Erfassung gilt das Set als neu (effectiveCondition ohne Zähler).
  const fallbackCond: Zustand = 'N';
  const needed: Zustand[] = acqs.length
    ? [...new Set(acqs.map(a => zustand(a.condition)))] : [fallbackCond];
  const preise = new Map<Zustand, PreisDaten>(needed.map(c => [c, setPreisAusVorrat(set.set_number, c, l.ttl, l.pre)]));
  const preisMap = new Map<string, number>();
  for (const [cond, p] of preise) {
    if (p.avg_price > 0) preisMap.set(`${set.set_number}|${cond}`, p.avg_price);
    if (p.ausstehend) l.fehlt.push({ art: 'set', nummer: set.set_number, zustand: cond });
  }
  const valued = valueSet(set.set_number, acqs, preisMap, fallbackCond, set.quantity || 1);
  const rows = valueAcquisitionRows(set.set_number, acqs, preisMap);
  // Ohne Erfassung kein Kaufpreis, nicht 0: Eine 0 sähe aus wie ein Geschenk.
  const purchase = weightedPurchase(rows);
  // Min/Max müssen zur selben Mengenaufteilung passen wie der Schnitt.
  const qty = valued.quantity || 1;
  const gewichtet = (key: 'min_price' | 'max_price' | 'qty_avg_price') => valued.by_condition
    .map(bc => (preise.get(bc.condition as Zustand)?.[key] ?? 0) * bc.quantity)
    .reduce((a, b) => a + b, 0) / qty;
  const einPreis = needed.map(c => preise.get(c)).find(p => p && !p.ausstehend);
  const ausstehend = needed.some(c => preise.get(c)?.ausstehend === true);
  const unitAvg = valued.unit_price ?? 0;
  const conditions = valued.by_condition.map(bc => bc.condition);
  return {
    user_id: set.user_id, set_number: set.set_number, name: set.name, year: set.year,
    image_local: resolveImageLocal(set.image_local), image_url: proxyImageUrl(set.image_url), added_at: set.added_at,
    quantity: qty,
    // Nur für Aufrufer, die eine einzelne Angabe erwarten.
    condition: conditions.includes('U') ? 'U' : 'N', conditions, mixed: conditions.length > 1,
    purchase_price: purchase,
    min_price: gewichtet('min_price'), avg_price: unitAvg, max_price: gewichtet('max_price'), qty_avg_price: gewichtet('qty_avg_price'),
    // Aus dem ungerundeten Stückpreis: 120,3333 × 2 ist 240,67, nicht 240,66.
    total_avg:     aufRappen((valued.unit_z ?? 0) * qty).toFixed(2),
    wert_gesamt:   aufRappen((valued.unit_z ?? 0) * qty),
    total_qty_avg: aufRappen((inZehntel4(gewichtet('qty_avg_price')) ?? 0) * qty).toFixed(2),
    pnl_pct: calcPnlPct(purchase, unitAvg), pnl_prozent: pnlProzent(purchase, unitAvg),
    acquisitions: rows,
    from_cache: true,
    is_fallback: einPreis?.is_fallback === true,
    // Ein ausstehender Preis ist noch keiner; ein Haken hiesse „geladen“.
    no_price: (!!einPreis || ausstehend) && valued.unit_price == null,
    bl_unbekannt: needed.some(c => preise.get(c)?.bl_unbekannt === true),
    preis_ausstehend: ausstehend,
    ...(ausstehend && l.ohneZugang && valued.unit_price == null ? { error: l.ohneZugang, error_code: 'kein_bricklink_zugang' } : {}),
  };
}

/** Summen aus den Zeilenwerten, gerundet erst am Schluss. */
function bewertungsSummen(zeilen: Array<{ quantity: number; min_price: number; max_price: number; qty_avg_price: number; total_avg: string }>) {
  let zMin = 0, zMax = 0, zQtyAvg = 0, zAvg = 0;
  for (const r of zeilen) {
    const q = r.quantity || 1;
    zMin += (inZehntel4(r.min_price) ?? 0) * q;
    zMax += (inZehntel4(r.max_price) ?? 0) * q;
    zQtyAvg += (inZehntel4(r.qty_avg_price) ?? 0) * q;
    zAvg += inZehntel4(r.total_avg) ?? 0;
  }
  return { min: aufRappen(zMin).toFixed(2), avg: aufRappen(zAvg).toFixed(2), max: aufRappen(zMax).toFixed(2), qty_avg: aufRappen(zQtyAvg).toFixed(2) };
}

/** Eine Umsetzung für Sitzungsroute und Token-API. */
export async function computeSetsValuation(viewerId: number, idsWahl: Sicht | Blickfeld) {
  // viewerId bestimmt die Einstellungen, ids die gerechneten Daten: Mit dem
  // Filter „Unterkonten" fehlt das fragende Konto in ids.
  const uids = await haushaltBereich().haushalt.blickfeldAus(idsWahl);
  const [currency, ttlHours, guideType] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'), getSetting(viewerId, 'price_cache_ttl', '24'),
    getSetting(viewerId, 'price_guide_type', 'sold')]);
  const kopf = { currency, condition: DEFAULT_PRICE_CONDITION, guide_type: guideType, ttl_hours: ttlHours,
    // ttl_hours bleibt für ältere Clients Text.
    ttl_stunden: Number(ttlHours) || 24 };
  const sets = await finanzenBereich().bewertung.setsZurBewertung(uids);
  if (!sets.length) return { ...kopf, kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0, sets: [], preise_ausstehend: 0,
    totals: { min: '0.00', avg: '0.00', max: '0.00', qty_avg: '0.00' } };

  // Je eine Abfrage für Katalog, Preiscache und Erfassungen statt einer je Set.
  const setNumbers = sets.map(s => s.set_number);
  const ttl = Math.max(1, parseInt(ttlHours) || 24);
  const [catRows, cacheRows, acqRows] = await Promise.all([
    // catalog_cache führt Nummern mit Versionsanhang, price_cache unter der Schreibweise des Aufrufers.
    finanzenBereich().bewertung.katalogMerkmale(setNumbers.map(mitVersion)),
    finanzenBereich().preisCache.setPreiseFrisch(setNumbers, currency, ttl),
    finanzenBereich().erfassungen.ladeSetErfassungen(uids, currency),
  ]);
  // Ohne BrickLink-Zugang kann der Auftrag nichts holen: Das steht dann an der Zeile.
  const ohneZugang = await getGlobalSetting('bricklink_consumer_key') ? null
    : fehlerText('kein_bricklink_zugang', await getSetting(viewerId, 'language', 'de') === 'en' ? 'en' : 'de');
  const lage: Bewertungslage = { ttl, fehlt: [], ohneZugang, pre: {
    catalog: new Map(catRows.map(r => [r.set_number, r])),
    cache:   new Map(cacheRows.map(r => [`${r.set_number}|${r.condition}`, r])),
  } };
  // Je Konto und Set: Im Haushalt ist jede Zeile der Bestand EINES Kontos.
  const jeKontoUndSet = new Map<string, SetErfassung[]>();
  for (const a of acqRows) {
    const k = `${a.user_id}|${a.set_number}`, l = jeKontoUndSet.get(k);
    if (l) l.push(a); else jeKontoUndSet.set(k, [a]);
  }
  const results = await haushaltBereich().haushalt.withOwners(uids,
    sets.map(set => bewerteSet(set, jeKontoUndSet.get(`${set.user_id}|${set.set_number}`) || [], lage)));
  return {
    ...kopf,
    // Fremde Kaufpreise fehlen in den Summen (keine Kurse); die Zahl sagt, wie viele es sind.
    kaufpreise_fremde_waehrung: zaehle(acqRows, 'kaufpreis_fremd'),
    kaufpreise_umgerechnet: zaehle(acqRows, 'kaufpreis_umgerechnet'),
    sets: results,
    totals: bewertungsSummen(results),
    preise_ausstehend: await merkePreiseVor(viewerId, currency, lage.fehlt),
  };
}

function conditionsOf(acqs: { condition?: string | null }[]): Zustand[] {
  if (!acqs?.length) return ['N'];
  const set = new Set(acqs.map(a => zustand(a.condition)));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

/** Je vorkommendem Zustand ein Preis; der erste mit Wert trägt die Zusatzangaben der Zeile. */
function preiseJeZustand<P extends PreisDaten>(key: string, conds: Zustand[], preisVon: (c: Zustand) => P) {
  const priceMap = new Map<string, number>();
  let priceData: P | null = null;
  for (const cond of conds) {
    const pd = preisVon(cond);
    // avg_price zuerst: Das ist BrickLinks angezeigter Preis, qty_avg_price liegt darunter.
    const v = pd.avg_price || pd.qty_avg_price || 0;
    if (v > 0) priceMap.set(`${key}|${cond}`, v);
    if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
  }
  return { priceMap, priceData };
}

function bewerteManuell(key: string, acqs: repo.ManuelleErfassung[], priceMap: Map<string, number>, menge: number) {
  // 'N': Der Rückfall greift nur ohne Erfassungen, und dort gilt „Neu".
  const valued  = valueSet(key, acqs, priceMap, 'N', menge);
  const rows    = valueAcquisitionRows(key, acqs, priceMap);
  const unitVal = valued.unit_price ?? 0;
  const totalQty = acqs.length ? valued.quantity : menge;
  // Ein Kaufpreis gilt nur in der Kontowährung; fremde Währung oder „unbekannt"
  // als 0 trieben die G&V auf Zehntausende Prozent.
  const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
  const hasCost = acqPurchase != null;
  const purchasePrice = acqPurchase ?? 0;
  const wert_z = (valued.unit_z ?? 0) * totalQty;
  return {
    condition: valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
    conditions: valued.by_condition.map(b => b.condition),
    acquisitions: rows,
    purchase_price: hasCost ? purchasePrice : null,
    pnl_pct: hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
    pnl_prozent: hasCost ? pnlProzent(purchasePrice, unitVal) : null,
    avg_price: unitVal, qty_avg_price: unitVal,
    wert_gesamt: aufRappen(wert_z),
    total_value: (wert_z / 10000).toFixed(4), display_value: aufRappen(wert_z).toFixed(2),
  };
}

/** Summe der Zeilenwerte, gerundet erst am Schluss; als Zahl und (veraltet) als Text. */
function gesamt(zeilen: Array<{ total_value: string }>) {
  const z = zeilen.reduce((s, r) => s + (inZehntel4(r.total_value) ?? 0), 0);
  return { wert_gesamt: aufRappen(z), total_value: aufRappen(z).toFixed(2) };
}

/** Eine Umsetzung für Sitzungsroute und Token-API. */
export async function computeMinifigsValuation(viewerId: number, idsWahl: Sicht | Blickfeld) {
  const uids = asIds(await haushaltBereich().haushalt.blickfeldAus(idsWahl));
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'), getGlobalSetting('price_cache_ttl', '24')]);
  const ttl = Math.max(1, parseInt(ttlHours) || 24);
  const manualFigs = await finanzenBereich().bewertung.manuelleFigurenZurBewertung(uids);
  if (!manualFigs.length) return { currency, figs: [], ...gesamt([]), kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0, preise_ausstehend: 0 };

  const acqByFig = await loadManualAcquisitions(uids, 'fig', currency);
  const mitBl = manualFigs.filter(f => f.bl_fig_number);
  const [figVorrat, schaetzungen] = await Promise.all([
    ladeFigurenpreiseVor(mitBl.map(f => String(f.bl_fig_number)), currency, ttlHours),
    finanzenBereich().marktpreise.geschaetzteFigurenpreise(manualFigs.filter(f => !f.bl_fig_number).map(f => f.fig_number), currency, ttl),
  ]);
  const fehlt: Posten[] = [];

  const results = await haushaltBereich().haushalt.withOwners(uids, manualFigs.map(fig => {
    // Je vorkommendem Zustand: Ein neu gekauftes Exemplar bekommt den Neupreis,
    // auch wenn ein anderes gebraucht ist.
    const key  = fig.fig_number;
    const acqs = acqByFig.get(`${fig.user_id}|${key}`) || [];
    const { priceMap, priceData } = preiseJeZustand(key, conditionsOf(acqs), (cond): FigurPreis => {
      if (fig.bl_fig_number) {
        const p = preisAusVorrat(c => figVorrat.get(`${fig.bl_fig_number}|${c}`), cond, ttl);
        if (p.ausstehend) fehlt.push({ art: 'figur', nummer: fig.bl_fig_number, zustand: cond });
        return p;
      }
      // Ohne BL-Nummer aus den Teilepreisen geschätzt (der Auftrag rechnet die Schätzung).
      const s = schaetzungen.get(`${key}|${cond}`);
      if (s) return { min_price: 0, avg_price: s.preis, max_price: 0, qty_avg_price: s.preis, from_cache: true,
        estimated_from_parts: true as const, abdeckung: s.abdeckung };
      fehlt.push({ art: 'schaetzung', nummer: key, zustand: cond });
      return { min_price: 0, avg_price: 0, max_price: 0, qty_avg_price: 0, from_cache: false, ausstehend: true as const };
    });
    return { ...fig, ...priceData, ...bewerteManuell(key, acqs, priceMap, fig.quantity || 1) };
  }));
  return { currency, figs: results, ...gesamt(results),
           kaufpreise_fremde_waehrung: fremdeKaufpreise(acqByFig),
           kaufpreise_umgerechnet: zaehle([...acqByFig.values()].flat(), 'kaufpreis_umgerechnet'),
           preise_ausstehend: await merkePreiseVor(viewerId, currency, fehlt) };
}

export async function computePartsValuation(viewerId: number, idsWahl: Sicht | Blickfeld) {
  const uids = asIds(await haushaltBereich().haushalt.blickfeldAus(idsWahl));
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'), getGlobalSetting('price_cache_ttl', '24')]);
  const ttl = Math.max(1, parseInt(ttlHours) || 24);
  const manualParts = await finanzenBereich().bewertung.manuelleTeileZurBewertung(uids);
  if (!manualParts.length) return { currency, parts: [], ...gesamt([]), kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0, preise_ausstehend: 0 };

  const blNummer = (p: repo.ManuellesTeil) => String(p.bl_part_number || p.part_number);
  await ladeBlNummernVor(manualParts.map(blNummer));
  const acqByPart = await loadManualAcquisitions(uids, 'part', currency);
  const teilVorrat = await ladeTeilepreiseVor(manualParts.map(p => ({
    partNumber: blNummer(p), rbColorId: p.color_id ?? KEINE_FARBE })), currency, ttlHours);
  const fehlt: Posten[] = [];

  const tasks = manualParts.map(part => async () => {
    const key  = `${part.part_number}|${part.color_id ?? KEINE_FARBE}`;
    const acqs = acqByPart.get(`${part.user_id}|${key}`) || [];
    const vorratsSchluessel = await teilSchluessel(blNummer(part), part.color_id ?? KEINE_FARBE);
    const { priceMap, priceData } = preiseJeZustand(key, conditionsOf(acqs), cond => {
      const p = preisAusVorrat(c => teilVorrat.get(`${vorratsSchluessel}|${c}`), cond, ttl);
      if (p.ausstehend) fehlt.push({ art: 'teil', nummer: blNummer(part), farbe: part.color_id ?? KEINE_FARBE, zustand: cond });
      return p;
    });
    const wert = bewerteManuell(key, acqs, priceMap, part.quantity || 1);
    return {
      id: part.id,
      user_id: part.user_id, part_number: part.part_number, bl_part_number: part.bl_part_number,
      part_name: part.part_name, color_id: part.color_id, color_name: part.color_name, color_hex: part.color_hex,
      quantity: part.quantity || 1, image_url: part.image_url, image_local: part.image_local,
      // Die neueste Erfassung; die Webapp nimmt den Wert nur als Rückfall.
      unit_price: acqs.at(-1)?.unit_price ?? null,
      ...priceData,
      // Nach ...priceData, damit der gewichtete Wert gewinnt.
      ...wert,
    };
  });

  const results = await haushaltBereich().haushalt.withOwners(uids, await parallelLimit(tasks, 5));
  return { currency, parts: results, ...gesamt(results),
           kaufpreise_fremde_waehrung: fremdeKaufpreise(acqByPart),
           kaufpreise_umgerechnet: zaehle([...acqByPart.values()].flat(), 'kaufpreis_umgerechnet'),
           preise_ausstehend: await merkePreiseVor(viewerId, currency, fehlt) };
}
