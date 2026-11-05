/** Was der Bestand heute wert ist; steht auf der Preisschicht (preise.ts) und
 * trägt die Gewinnrechnung, nicht umgekehrt. */

import { meldeUndLiefere, fehlertext } from '../../infra/fehler';
import * as repo from '../repository/bewertung';
import { setPreiseFrisch } from '../repository/preisCache';
import { asIds, withOwners, blickfeldAus, type Sicht } from '../../haushalt/haushalt';
import { getGlobalSetting, getSetting } from '../../einstellungen/settings';
import { resolveImageLocal, proxyImageUrl } from '../../katalog/bilder/images';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct, pnlProzent } from '../setValue';
import { mitVersion } from '../../infra/setNummer';
import { effectiveCondition } from './zustand';
import {
  DEFAULT_PRICE_CONDITION, parallelLimit,
  fetchPrice, fetchPartPrice, fetchMinifigPrice, ladeBlNummernVor,
  ladeTeilepreiseVor, ladeFigurenpreiseVor,
  type Blickfeld,
} from './preise';
import { zaehle } from './abfragen';
import { ladeSetErfassungen } from '../repository/erfassungen';
import { schaetzeFigurenpreis } from '../marketPrice';
import { KEINE_FARBE } from '../../infra/validate';
import { aufRappen, inZehntel4 } from '../../infra/geld';

/** @returns Map key → Erfassungszeilen; key ist `konto|nummer|farbe` bzw. `konto|nummer` */
async function loadManualAcquisitions(uid: Blickfeld, kind: 'part' | 'fig', waehrung: string) {
  // Ein Hauptkonto bewertet den ganzen Haushalt; die Währung ist beim
  // Verknüpfen erzwungen gleich, sonst summierte das zwei Währungen.
  const rows = await repo.manuelleErfassungen(kind, asIds(uid), waehrung)
    .catch(meldeUndLiefere('bewertung:rows', []));
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

/** Eine Umsetzung für Sitzungsroute und Token-API. */
export async function computeSetsValuation(viewerId: number, idsWahl: Sicht | Blickfeld) {
  const ids = await blickfeldAus(idsWahl);
  // viewerId bestimmt die Einstellungen, ids die gerechneten Daten: Mit dem
  // Filter „Unterkonten" fehlt das fragende Konto in ids.
  const uids = asIds(ids);
  const [currency, ttlHours, guideType] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getSetting(viewerId, 'price_cache_ttl', '24'),
    getSetting(viewerId, 'price_guide_type', 'sold'),
  ]);
  const defaultCondition = DEFAULT_PRICE_CONDITION;

  const sets = await repo.setsZurBewertung(uids);
  if (!sets.length) return { currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours,
    ttl_stunden: Number(ttlHours) || 24, kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0, sets: [], totals: { min:'0.00', avg:'0.00', max:'0.00', qty_avg:'0.00' } };

  // Je eine Abfrage für Katalog, Preiscache und Erfassungen statt einer je Set.
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const [catRows, cacheRows, acqRows] = await Promise.all([
    // catalog_cache führt Nummern mit Versionsanhang, price_cache unter der
    // Schreibweise des Aufrufers.
    repo.katalogMerkmale(setNumbers.map(mitVersion)),
    setPreiseFrisch(setNumbers, String(currency), ttl),
    ladeSetErfassungen(uids, String(currency)),
  ]);
  const pre = {
    catalog: new Map(catRows.map(r => [r.set_number, r])),
    cache:   new Map(cacheRows.map(r => [`${r.set_number}|${r.condition}`, r])),
  };
  // Je Konto und Set: Im Haushalt ist jede Zeile der Bestand EINES Kontos;
  // nach Setnummer allein zählte jede Zeile die Käufe aller Konten mit.
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const k = `${a.user_id}|${a.set_number}`;
    const list = acqBySet.get(k);
    if (list) list.push(a); else acqBySet.set(k, [a]);
  }

  const tasks = sets.map(set => async () => {
    const acqs = acqBySet.get(`${set.user_id}|${set.set_number}`) || [];
    const imgLocal = resolveImageLocal(set.image_local);
    const imgUrl   = proxyImageUrl(set.image_url);
    const base = {
      user_id: set.user_id, set_number: set.set_number, name: set.name, year: set.year,
      image_local: imgLocal, image_url: imgUrl, added_at: set.added_at,
    };

    // Preise NUR für die vorkommenden Zustände: Jeder Abruf kostet Kontingent.
    const fallbackCond: 'N' | 'U' = effectiveCondition(set);
    const needed: Array<'N' | 'U'> = acqs.length
      ? [...new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')))] as Array<'N'|'U'>
      : [fallbackCond];

    const priceByCond: Record<string, any> = {};
    const errors: string[] = [];
    for (const cond of needed) {
      try {
        priceByCond[cond] = await fetchPrice(set.set_number, cond, guideType, currency, ttlHours, pre);
      } catch (e) {
        priceByCond[cond] = null;
        errors.push(fehlertext(e));
      }
    }

    // Dieselbe Form wie loadConditionPrices(), damit die Bewertungsregel an
    // EINER Stelle (valueSet) bleibt.
    const priceMapForSet = new Map<string, number>();
    for (const cond of needed) {
      const v = parseFloat(String(priceByCond[cond]?.avg_price || 0));
      if (v > 0) priceMapForSet.set(`${set.set_number}|${cond}`, v);
    }

    const valued = valueSet(set.set_number, acqs, priceMapForSet, fallbackCond, set.quantity || 1);
    // Je Kaufpreis eine Zeile, jede mit dem Preis IHRES Zustands.
    const rows = valueAcquisitionRows(set.set_number, acqs, priceMapForSet);
    // Ohne Erfassung kein Kaufpreis, nicht 0: Eine 0 sähe aus wie ein Geschenk.
    const purchase = weightedPurchase(rows);

    // Min/Max müssen zur selben Mengenaufteilung passen wie der Schnitt.
    const qty = valued.quantity || 1;
    const weighted = (key: 'min_price' | 'max_price' | 'qty_avg_price') => {
      const parts = valued.by_condition.map(bc => {
        const raw = parseFloat(String(priceByCond[bc.condition]?.[key] || 0)) || 0;
        return raw * bc.quantity;
      });
      return parts.reduce((a, b) => a + b, 0) / qty;
    };

    const anyPrice = needed.map(c => priceByCond[c]).find(p => p);
    const unitAvg = valued.unit_price ?? 0;
    // Fehler nur, wenn KEIN Zustand einen Preis hat: Die gelungene Hälfte eines
    // gemischten Sets soll nicht an der anderen scheitern.
    const failedAll = errors.length === needed.length;
    const conditions = valued.by_condition.map(bc => bc.condition);

    return {
      ...base,
      quantity: qty,
      // Nur für Aufrufer, die eine einzelne Angabe erwarten; die Bewertung hängt
      // an den Zuständen der Einzelzeilen.
      condition: conditions.includes('U') ? 'U' : 'N',
      conditions,
      mixed: conditions.length > 1,
      purchase_price: purchase,
      min_price: weighted('min_price'),
      avg_price: unitAvg,
      max_price: weighted('max_price'),
      qty_avg_price: weighted('qty_avg_price'),
      // Aus dem ungerundeten Stückpreis: 120,3333 × 2 ist 240,67, nicht 240,66.
      total_avg:     aufRappen((valued.unit_z ?? 0) * qty).toFixed(2),
      wert_gesamt:   aufRappen((valued.unit_z ?? 0) * qty),
      total_qty_avg: aufRappen((inZehntel4(weighted('qty_avg_price')) ?? 0) * qty).toFixed(2),
      pnl_pct: calcPnlPct(purchase, unitAvg),
      pnl_prozent: pnlProzent(purchase, unitAvg),
      acquisitions: rows,
      from_cache: anyPrice ? !!anyPrice.from_cache : true,
      is_fallback: anyPrice ? !!anyPrice.is_fallback : false,
      no_price: !failedAll && valued.unit_price == null,
      bl_unbekannt: needed.some(c => priceByCond[c]?.bl_unbekannt === true),
      ...(failedAll ? { error: errors[0] } : {}),
    };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  // Summen aus den Zeilenwerten, gerundet erst am Schluss.
  let zMin = 0, zMax = 0, zQtyAvg = 0, zAvg = 0;
  for (const r of results) {
    const q = r.quantity || 1;
    zMin += (inZehntel4(r.min_price) ?? 0) * q;
    zMax += (inZehntel4(r.max_price) ?? 0) * q;
    zQtyAvg += (inZehntel4(r.qty_avg_price) ?? 0) * q;
    zAvg += inZehntel4(r.total_avg) ?? 0;
  }
  return {
    currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours,
    // ttl_hours bleibt für ältere Clients Text.
    ttl_stunden: Number(ttlHours) || 24,
    // Fremde Kaufpreise fehlen in den Summen (keine Kurse); die Zahl sagt, wie
    // viele es sind, statt sie still wegzulassen.
    kaufpreise_fremde_waehrung: zaehle(acqRows, 'kaufpreis_fremd'),
    kaufpreise_umgerechnet: zaehle(acqRows, 'kaufpreis_umgerechnet'),
    sets: results,
    totals: { min: aufRappen(zMin).toFixed(2), avg: aufRappen(zAvg).toFixed(2), max: aufRappen(zMax).toFixed(2), qty_avg: aufRappen(zQtyAvg).toFixed(2) },
  };
}

/** Eine Umsetzung für Sitzungsroute und Token-API. */
export async function computeMinifigsValuation(viewerId: number, idsWahl: Sicht | Blickfeld) {
  const ids = await blickfeldAus(idsWahl);
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const manualFigs = await repo.manuelleFigurenZurBewertung(uids);
  if (!manualFigs.length) return { currency, figs: [], total_value: '0.00', kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0 };

  const acqByFig = await loadManualAcquisitions(uids, 'fig', String(currency));
  const figVorrat = await ladeFigurenpreiseVor(
    manualFigs.filter(f => f.bl_fig_number).map(f => String(f.bl_fig_number)), String(currency), ttlHours);

  const tasks = manualFigs.map(fig => async () => {
    // Je vorkommendem Zustand: Ein neu gekauftes Exemplar bekommt den Neupreis,
    // auch wenn ein anderes gebraucht ist.
    const key  = String(fig.fig_number);
    const acqs = acqByFig.get(`${fig.user_id}|${key}`) || [];
    const conds  = conditionsOf(acqs);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      if (fig.bl_fig_number) {
        try { pd = await fetchMinifigPrice(fig.bl_fig_number, cond, currency, ttlHours, figVorrat); }
        catch (e) { pd = { avg_price: 0, qty_avg_price: 0, error: fehlertext(e) }; }
      } else {
        // Ohne BL-Nummer aus den Teilepreisen schätzen: Die Zuordnung RB→BL ist für
        // Teile verlässlich, für Figuren nicht.
        const s = await schaetzeFigurenpreis(fig.fig_number, viewerId, cond).catch(meldeUndLiefere('bewertung:schaetzeFigurenpreis', null));
        pd = s != null
          ? { avg_price: s.preis, qty_avg_price: s.preis, from_cache: false, estimated_from_parts: true, abdeckung: s.abdeckung }
          : { avg_price: 0, qty_avg_price: 0 };
      }
      // avg_price zuerst: Das ist BrickLinks angezeigter Preis, qty_avg_price liegt
      // darunter. "0.00" aus Postgres ist truthy und hätte avg_price verdeckt.
      const v = parseFloat(String(pd.avg_price || 0)) || parseFloat(String(pd.qty_avg_price || 0)) || 0;
      if (v > 0) priceMap.set(`${key}|${cond}`, v);
      if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
    }

    const qty = fig.quantity || 1;
    // 'N': Der Rückfall greift nur ohne Erfassungen, und dort gilt „Neu".
    const valued  = valueSet(key, acqs, priceMap, 'N', qty);
    const rows    = valueAcquisitionRows(key, acqs, priceMap);
    const unitVal = valued.unit_price ?? 0;
    const totalQty = acqs.length ? valued.quantity : qty;
    const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
    // Ein Kaufpreis gilt nur in der Kontowährung; fremde Währung oder „unbekannt"
    // als 0 trieben die G&V auf Zehntausende Prozent.
    const hasCost = acqPurchase != null;
    const purchasePrice = acqPurchase ?? 0;
    return { ...fig, ...priceData,
      condition: valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions: valued.by_condition.map(b => b.condition),
      // Dieselbe Form wie bei Sets, damit die Finanztabelle für alle drei gleich aussieht.
      acquisitions: rows,
      avg_price: unitVal, qty_avg_price: unitVal,
      purchase_price: hasCost ? purchasePrice : null,
      pnl_pct: hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      pnl_prozent: hasCost ? pnlProzent(purchasePrice, unitVal) : null,
      wert_gesamt: aufRappen((valued.unit_z ?? 0) * totalQty),
      total_value: ((valued.unit_z ?? 0) * totalQty / 10000).toFixed(4), display_value: aufRappen((valued.unit_z ?? 0) * totalQty).toFixed(2) };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((s, r) => s + (inZehntel4(r.total_value) ?? 0), 0);
  return { currency, figs: results, total_value: aufRappen(total).toFixed(2),
           kaufpreise_fremde_waehrung: fremdeKaufpreise(acqByFig),
           kaufpreise_umgerechnet: zaehle([...acqByFig.values()].flat(), 'kaufpreis_umgerechnet') };
}

export async function computePartsValuation(viewerId: number, idsWahl: Sicht | Blickfeld) {
  const ids = await blickfeldAus(idsWahl);
  const uids = asIds(ids);
  const [currency, ttlHours] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getGlobalSetting('price_cache_ttl', '24'),
  ]);
  const manualParts = await repo.manuelleTeileZurBewertung(uids);

  if (!manualParts.length) return { currency, parts: [], total_value: '0.00', kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0 };

  // Zwei Abfragen statt 2×N; der Schlüssel muss zeichengleich dem von
  // fetchPartPrice sein, sonst greift das Gedächtnis daneben.
  await ladeBlNummernVor(manualParts.map(p => String(p.bl_part_number || p.part_number)));

  const acqByPart = await loadManualAcquisitions(uids, 'part', String(currency));
  const teilVorrat = await ladeTeilepreiseVor(manualParts.map(p => ({
    partNumber: String(p.bl_part_number || p.part_number), rbColorId: p.color_id ?? KEINE_FARBE })), String(currency), ttlHours);

  const tasks = manualParts.map(part => async () => {
    const key    = `${part.part_number}|${part.color_id ?? KEINE_FARBE}`;
    const acqs   = acqByPart.get(`${part.user_id}|${key}`) || [];
    const conds  = conditionsOf(acqs);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      try {
        pd = await fetchPartPrice(part.bl_part_number || part.part_number, part.color_id ?? KEINE_FARBE, cond, currency, ttlHours, teilVorrat);
      } catch (e) {
        pd = { avg_price: 0, qty_avg_price: 0, error: fehlertext(e) };
      }
      // avg_price zuerst, wie bei den Figuren.
      const v = parseFloat(String(pd.avg_price || 0)) || parseFloat(String(pd.qty_avg_price || 0)) || 0;
      if (v > 0) priceMap.set(`${key}|${cond}`, v);
      if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
    }

    const qty     = part.quantity || 1;
    // 'N': Der Rückfall greift nur ohne Erfassungen, und dort gilt „Neu".
    const valued  = valueSet(key, acqs, priceMap, 'N', qty);
    const rows    = valueAcquisitionRows(key, acqs, priceMap);
    const unitVal = valued.unit_price ?? 0;
    const totalQty = acqs.length ? valued.quantity : qty;
    const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
    const hasCost = acqPurchase != null;
    const purchasePrice = acqPurchase ?? 0;
    return {
      id:           part.id,
      // user_id gehört in die Antwort: withOwnerNames() macht daraus `owners`.
      user_id:      part.user_id,
      part_number:  part.part_number,
      bl_part_number: part.bl_part_number,
      part_name:    part.part_name,
      color_id:     part.color_id,
      color_name:   part.color_name,
      color_hex:    part.color_hex,
      quantity:     qty,
      image_url:    part.image_url,
      image_local:  part.image_local,
      // Die neueste Erfassung; die Webapp nimmt den Wert nur als Rückfall.
      unit_price:   acqs.at(-1)?.unit_price ?? null,
      purchase_price: hasCost ? purchasePrice : null,
      condition:    valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions:   valued.by_condition.map(b => b.condition),
      acquisitions: rows,
      pnl_pct:      hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      pnl_prozent:  hasCost ? pnlProzent(purchasePrice, unitVal) : null,
      ...priceData,
      // Nach ...priceData, damit der gewichtete Wert gewinnt.
      avg_price:    unitVal,
      qty_avg_price: unitVal,
      total_value:  ((valued.unit_z ?? 0) * totalQty / 10000).toFixed(4),
      display_value: aufRappen((valued.unit_z ?? 0) * totalQty).toFixed(2),
      wert_gesamt:  aufRappen((valued.unit_z ?? 0) * totalQty),
    };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((sum, r) => sum + (inZehntel4(r.total_value) ?? 0), 0);
  return { currency, parts: results, total_value: aufRappen(total).toFixed(2),
           kaufpreise_fremde_waehrung: fremdeKaufpreise(acqByPart),
           kaufpreise_umgerechnet: zaehle([...acqByPart.values()].flat(), 'kaufpreis_umgerechnet') };
}

/** Ohne Erfassung „Neu", wie conditionsFromAcquisitions(). */
function conditionsOf(acqs: { condition?: string | null }[]): ('N' | 'U')[] {
  if (!acqs?.length) return ['N'];
  const set = new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

/** Nur im Haushalt; manuelle Einträge zweier Konten bleiben getrennte Zeilen. */
async function withOwnerNames(uids: number[], rows: any[]): Promise<any[]> {
  return withOwners(uids, rows);
}

