/**
 * BEWERTUNG: Was ist der Bestand heute wert — Sets, Minifiguren, Teile.
 *
 * Steht auf der Preisschicht (preise.ts) und wird von der Gewinnrechnung
 * (gewinnVerlust.ts) benutzt. Warum die drei getrennt sind, steht im Kopf von
 * preise.ts.
 */

import * as db from '../../db/database';
import { asIds } from '../household';
import { getSetting, getGlobalSetting } from '../settings';
import { resolveImageLocal, proxyImageUrl } from '../images';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct } from '../setValue';
import { mitVersion } from '../setNummer';
import { effectiveCondition } from './zustand';
import { mengeJoin, mengeAus } from '../bestandsmenge';
import {
  DEFAULT_PRICE_CONDITION, PRICE_CACHE_COLS, parallelLimit,
  fetchPrice, fetchPartPrice, fetchMinifigPrice, ladeBlNummernVor,
  type Blickfeld,
} from './preise';
import { ladeSetErfassungen } from './abfragen';
import { blJoin, blNummerSql } from '../blZuordnung';
import { teilmengeJoin, teilmengeAus } from '../bestandsmenge';

/**
 * Erfassungen manueller Teile bzw. Minifiguren, gruppiert nach Eintrag.
 * Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#loadmanualacquisitions
 * @param {'part'|'fig'} kind
 * @returns Map key → Erfassungszeilen; key ist `nummer|farbe` bzw. `nummer`
 */
async function loadManualAcquisitions(uid: Blickfeld, kind: 'part' | 'fig', waehrung: string) {
  // Blickfeld: Ein Hauptkonto bewertet den ganzen Haushalt. Die Währung ist
  // beim Verknüpfen erzwungen gleich (utils/household.ts) — sonst summierte
  // diese Rechnung zwei Währungen, ohne dass man es der Zahl ansähe.
  const uids = asIds(uid as any);
  const rows = await db.all(
    kind === 'part'
      ? `SELECT id, part_number, color_id, quantity,
                CASE WHEN currency = $2 THEN unit_price END AS unit_price, currency, price_estimated,
                COALESCE(condition,'N') AS condition, created_at
           FROM part_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`
      : `SELECT id, fig_number, quantity,
                CASE WHEN currency = $2 THEN unit_price END AS unit_price, currency, price_estimated,
                COALESCE(condition,'N') AS condition, created_at
           FROM minifig_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`,
    [uids, waehrung]
  ).catch(() => []);
  const out = new Map<string, any[]>();
  for (const r of rows) {
    const key = kind === 'part' ? `${r.part_number}|${r.color_id || 0}` : String(r.fig_number);
    const list = out.get(key);
    if (list) list.push(r); else out.set(key, [r]);
  }
  return out;
}

// ── Compute the price valuation for all of a user's sets ────────────────────
// Shared by the session route (/finance/valuation) and the token API
// (/api/v1/finance/valuation) so the logic exists exactly once.
async function computeSetsValuation(viewerId: number, ids: Blickfeld) {
  // ZWEI Grössen, bewusst getrennt:
  //   viewerId — wessen EINSTELLUNGEN gelten (Währung, Cache-Dauer, Preisart)
  //   ids      — WESSEN DATEN gerechnet werden (Blickfeld, ggf. gefiltert)
  //
  // Sie fallen auseinander, sobald der Kontofilter auf „Unterkonten" steht:
  // Dann enthält ids das fragende Konto gar nicht. Die Einstellungen mit
  // ids[0] zu holen hiesse dort, die Währung eines Kindes zu benutzen.
  const uids = asIds(ids);
  const [currency, ttlHours, guideType] = await Promise.all([
    getSetting(viewerId, 'currency', 'EUR'),
    getSetting(viewerId, 'price_cache_ttl', '24'),
    getSetting(viewerId, 'price_guide_type', 'sold'),
  ]);
  const defaultCondition = DEFAULT_PRICE_CONDITION;

  const sets = await db.all(
    // Kaufpreis und Zustand stehen seit Migration 0032 NUR in den Erfassungen
    // (set_acquisitions), eine Zeile je Kauf. Der frühere Rückfall auf
    // s.purchase_price/s.condition ist weg: Die Migration hat für jede
    // Set-Zeile eine Erfassung nachgetragen und prüft das auch nach, und alle …
    // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computesetsvaluation
    `SELECT s.set_number, c.name, c.year,
            ${mengeAus('sm', 0)}::int AS quantity,
            c.image_local, c.image_url, s.added_at
       FROM sets s
       LEFT JOIN set_catalog c ON c.set_number = s.set_number
       ${mengeJoin('s')}
      WHERE s.user_id = ANY($1)`, [uids]);
  if (!sets.length) return { currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours, sets: [], totals: { min:'0.00', avg:'0.00', max:'0.00', qty_avg:'0.00' } };

  // Batch-Prefetch: Katalog-Flags, Preiscache (beide Zustände) und ALLE
  // Erfassungen in je einer Query — sonst wäre das eine Abfrage je Set.
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const [catRows, cacheRows, acqRows] = await Promise.all([
    // mitVersion(): catalog_cache wird von clients/bricklink.ts unter der
    // Nummer MIT Anhang gefuellt, price_cache dagegen unter der, die der
    // Aufrufer mitgibt. Die beiden Tabellen haben also VERSCHIEDENE
    // Schluesselgewohnheiten — deshalb wird hier normalisiert und in der
    // Abfrage darunter nicht.
    db.all('SELECT set_number, is_gear, bl_type, fetched_at FROM catalog_cache WHERE set_number = ANY($1)',
           [setNumbers.map(mitVersion)]),
    db.all(
      `SELECT ${PRICE_CACHE_COLS} FROM price_cache
       WHERE set_number = ANY($1) AND currency_code = $2 AND fetched_at > NOW() - make_interval(hours => $3)`,
      [setNumbers, currency, ttl]),
    ladeSetErfassungen(uids, String(currency)),
  ]);
  const pre = {
    catalog: new Map(catRows.map(r => [r.set_number, r])),
    cache:   new Map(cacheRows.map(r => [`${r.set_number}|${r.condition}`, r])),
  };
  const acqBySet = new Map<string, any[]>();
  for (const a of acqRows) {
    const list = acqBySet.get(a.set_number);
    if (list) list.push(a); else acqBySet.set(a.set_number, [a]);
  }

  const tasks = sets.map(set => async () => {
    const acqs = acqBySet.get(set.set_number) || [];
    const imgLocal = resolveImageLocal(set.image_local);
    const imgUrl   = proxyImageUrl(set.image_url);
    const base = {
      set_number: set.set_number, name: set.name, year: set.year,
      image_local: imgLocal, image_url: imgUrl, added_at: set.added_at,
    };

    //  Preise NUR für die tatsächlich vorkommenden Zustände holen
    // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computesetsvaluation-fallbackcond
    const fallbackCond: 'N' | 'U' = effectiveCondition(set);
    const needed: Array<'N' | 'U'> = acqs.length
      ? [...new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')))] as Array<'N'|'U'>
      : [fallbackCond];

    const priceByCond: Record<string, any> = {};
    const errors: string[] = [];
    for (const cond of needed) {
      try {
        priceByCond[cond] = await fetchPrice(set.set_number, cond, guideType, currency, ttlHours, pre);
      } catch (e: any) {
        priceByCond[cond] = null;
        errors.push(e.message);
      }
    }

    // Preise als Map "setNummer|Zustand" → avg_price: dieselbe Form, die
    // loadConditionPrices() liefert, damit valueSet() unverändert benutzt
    // werden kann — die Bewertungsregel bleibt an EINER Stelle.
    const priceMapForSet = new Map<string, number>();
    for (const cond of needed) {
      const v = parseFloat(String(priceByCond[cond]?.avg_price || 0));
      if (v > 0) priceMapForSet.set(`${set.set_number}|${cond}`, v);
    }

    // Set-Zeile: derselbe gewichtete Stückpreis wie überall sonst.
    const valued = valueSet(set.set_number, acqs, priceMapForSet, fallbackCond, set.quantity || 1);
    // Einzelzeilen: eine je Kaufpreis, jede mit dem Preis IHRES Zustands.
    const rows = valueAcquisitionRows(set.set_number, acqs, priceMapForSet);
    // Ohne Erfassung kein Kaufpreis — und nicht 0. Eine 0 sähe in den Summen
    // wie ein erfasstes Geschenk aus.
    const purchase = weightedPurchase(rows);

    // Min/Max analog gewichtet — sie speisen nur die Min/Max-Kacheln oben,
    // müssen aber zur selben Mengenaufteilung passen wie der Schnitt.
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
    // Fehlerfall nur, wenn KEIN Zustand einen Preis geliefert hat — bei einem
    // gemischten Set soll die eine gelungene Hälfte nicht an der anderen
    // scheitern.
    const failedAll = errors.length === needed.length;
    const conditions = valued.by_condition.map(bc => bc.condition);

    return {
      ...base,
      quantity: qty,
      // Zustand des Bestandes wie bisher (gebraucht, sobald eine Erfassung
      // gebraucht ist) — für Aufrufer, die eine einzelne Angabe erwarten.
      // Die BEWERTUNG hängt nicht mehr daran; die Einzelzeilen tragen ihren
      // eigenen Zustand.
      condition: conditions.includes('U') ? 'U' : 'N',
      conditions,
      mixed: conditions.length > 1,
      purchase_price: purchase,
      min_price: weighted('min_price'),
      avg_price: unitAvg,
      max_price: weighted('max_price'),
      qty_avg_price: weighted('qty_avg_price'),
      total_avg:     (unitAvg * qty).toFixed(2),
      total_qty_avg: (weighted('qty_avg_price') * qty).toFixed(2),
      pnl_pct: calcPnlPct(purchase, unitAvg),
      acquisitions: rows,
      from_cache: anyPrice ? !!anyPrice.from_cache : true,
      is_fallback: anyPrice ? !!anyPrice.is_fallback : false,
      no_price: !failedAll && valued.unit_price == null,
      // Grund für die Anzeige: BrickLink führt das Set (noch) nicht.
      bl_unbekannt: needed.some(c => priceByCond[c]?.bl_unbekannt === true),
      ...(failedAll ? { error: errors[0] } : {}),
    };
  });

  const results = await parallelLimit(tasks, 5);
  let totalMin=0, totalAvg=0, totalMax=0, totalQtyAvg=0;
  for (const r of results) { const q=r.quantity||1; totalMin+=(r.min_price||0)*q; totalAvg+=(r.avg_price||0)*q; totalMax+=(r.max_price||0)*q; totalQtyAvg+=(r.qty_avg_price||0)*q; }
  return {
    currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours, sets: results,
    totals: { min:totalMin.toFixed(2), avg:totalAvg.toFixed(2), max:totalMax.toFixed(2), qty_avg:totalQtyAvg.toFixed(2) },
  };
}

// ── Compute valuation for all manually captured minifigs of a user ──────────
// Shared by the session route (/finance/minifigs-valuation) and the token API
// (/api/v1/finance/minifigs-valuation) so the logic exists exactly once.
async function computeMinifigsValuation(viewerId: number, ids: Blickfeld) {
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
  // Kein defaultCondition mehr: Es stand hier ausschliesslich fuer den
  // Rueckfall, den effectiveCondition() jetzt richtig macht. Der Compiler hat
  // das gemeldet, sobald der Rueckfall weg war — ein Wert, den niemand mehr
  // liest, ist der beste Beleg dafuer, dass er nur den Fehler getragen hat.
  // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computeminifigsvaluation-manualfigs
  const manualFigs = await db.all(`
    SELECT m.id, m.user_id, m.set_number, m.fig_number,
           -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
           -- stand m.bl_fig_number, eine Abschrift je Konto.
           ${blNummerSql('m.fig_number', 'blzf')} AS bl_fig_number,
           -- Die Stückzahl aus den Erfassungen (Migration 0038); hier stand
           -- m.quantity. Nur manuelle Figuren, siehe die Bedingung unten.
           ${teilmengeAus('m', 'fig')} AS quantity,
           m.source, m.storage_id,
           -- unit_price, purchase_price und condition sind mit Migration 0035
           -- weg. Die Bewertung rechnet ohnehin aus den ERFASSUNGEN
           -- (loadManualAcquisitions oben) — die drei Spalten waren eine
           -- Abschrift der letzten davon.
           mc.fig_name, mc.image_url, mc.image_local
      FROM minifigs m
      ${teilmengeJoin('m', 'fig')}
      ${blJoin('m.fig_number', 'fig', 'blzf')}
      LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
     WHERE m.user_id = ANY($1) AND m.source='manual'`, [uids]);
  if (!manualFigs.length) return { currency, figs: [], total_value: '0.00' };

  const acqByFig = await loadManualAcquisitions(uids, 'fig', String(currency));

  const tasks = manualFigs.map(fig => async () => {
    // Marktpreis kommt immer live von BrickLink (globaler, geteilter Preiscache
    // mit TTL — analog zu Sets). Preis/Stk bzw. Kaufpreis beeinflussen nur die
    // G&V-Basis, nicht mehr den angezeigten Marktpreis/aktuellen Wert.
    //
    // NEU: je vorkommendem Zustand ein Preis. Vorher gab es genau einen — und
    // sobald EINE Erfassung gebraucht war, wurde auch das neu gekaufte
    // Exemplar mit dem Gebrauchtpreis bewertet.
    const key  = String(fig.fig_number);
    const acqs = acqByFig.get(key) || [];
    // Der Zustand des STUECKS, nicht der Preisabfrage.
    // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computeminifigsvaluation-conds
    const conds  = conditionsOf(acqs);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      if (fig.bl_fig_number) {
        try { pd = await fetchMinifigPrice(fig.bl_fig_number, cond, currency, ttlHours); }
        catch (e: any) { pd = { avg_price: 0, qty_avg_price: 0, error: e.message }; }
      } else {
        // Keine BrickLink-Nummer hinterlegt: Marktpreis aus den einzelnen
        // BrickLink-Teilepreisen der Minifigur schätzen (Rebrickable→BrickLink-
        // Zuordnung existiert zuverlässig für Teile, nicht für Minifiguren).
        // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computeminifigsvaluation
        const { estimateFigPriceFromParts } = require('../marketPrice');
        const estimated = await estimateFigPriceFromParts(fig.fig_number, viewerId, cond).catch(() => null);
        pd = estimated != null
          ? { avg_price: estimated, qty_avg_price: estimated, from_cache: false, estimated_from_parts: true }
          : { avg_price: 0, qty_avg_price: 0 };
      }
      // avg_price zuerst: BrickLinks angezeigter "Avg Price". qty_avg_price ist
      // der mengengewichtete Schnitt und liegt systematisch darunter. Zusätzlich
      // ist "0.00" aus Postgres truthy und hätte avg_price verdeckt.
      const v = parseFloat(String(pd.avg_price || 0)) || parseFloat(String(pd.qty_avg_price || 0)) || 0;
      if (v > 0) priceMap.set(`${key}|${cond}`, v);
      if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
    }

    const qty = fig.quantity || 1;
    // Gewichteter Stückwert über die Erfassungen — dieselbe Regel wie bei Sets.
    // 'N' statt eines gespeicherten Zustands: Der Rueckfall greift nur ohne
    // Erfassungen, und dort gilt „Neu“ (siehe conditionsOf unten).
    const valued  = valueSet(key, acqs, priceMap, 'N', qty);
    const rows    = valueAcquisitionRows(key, acqs, priceMap);
    const unitVal = valued.unit_price ?? 0;
    const totalQty = acqs.length ? valued.quantity : qty;
    // Kaufpreis ebenfalls mengengewichtet; ohne Erfassungen die Stammzeile.
    const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
    // Kaufpreis: aus den Erfassungen, 0 wenn keiner bekannt
    // Genau das bleibt, nur ohne zweite Spalte: Migration 0035 garantiert
    // eine Erfassung, also ist hasCost weiter wahr, und der Anzeigewert wird
    // hier gebildet statt gespeichert.
    // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computeminifigsvaluation-hascost
    const hasCost = acqs.length > 0;
    const purchasePrice = acqPurchase ?? 0;
    return { ...fig, ...priceData,
      condition: valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions: valued.by_condition.map(b => b.condition),
      // Eine Zeile je Kaufpreis — dieselbe Form wie bei Sets, damit die
      // Finanztabelle für alle drei Arten gleich aussieht.
      acquisitions: rows,
      avg_price: unitVal, qty_avg_price: unitVal,
      purchase_price: hasCost ? purchasePrice : null,
      pnl_pct: hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      total_value: (unitVal * totalQty).toFixed(4), display_value: (unitVal * totalQty).toFixed(2) };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
  return { currency, figs: results, total_value: total.toFixed(2) };
}

// ── GET /api/finance/minifigs-valuation ───────────────────────────────────────
async function computePartsValuation(viewerId: number, ids: Blickfeld) {
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
  // Kein defaultCondition mehr — siehe die Figuren-Bewertung darueber.
  // Spalten ausgeschrieben, kein SELECT * — dieselbe Begruendung wie bei den
  // Figuren darueber. Die Beschreibung kommt aus den Katalogen (Migration
  // 0034), der Bestand aus parts.
  const manualParts = await db.all(`
    SELECT p.id, p.user_id, p.set_number, p.part_number,
           -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
           -- stand p.bl_part_number, eine Abschrift je Konto.
           ${blNummerSql('p.part_number')} AS bl_part_number,
           p.color_id,
           -- Wie bei den Figuren darueber (Migration 0038).
           ${teilmengeAus('p', 'part')} AS quantity,
           p.source,
           p.storage_id, p.added_at,
           -- Preise und Zustand: siehe die Figuren-Bewertung darueber
           -- (Migration 0035).
           pc.part_name, pc.category_name,
           pcc.color_name, pcc.color_hex, pcc.image_url, pcc.image_local
      FROM parts p
      ${teilmengeJoin('p', 'part')}
      ${blJoin('p.part_number', 'part')}
      LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                      AND pcc.color_id    = p.color_id
     WHERE p.user_id = ANY($1) AND p.source = 'manual'`, [uids]);

  if (!manualParts.length) return { currency, parts: [], total_value: '0.00' };

  // Die BrickLink-Nummern aller Teile in zwei Abfragen statt in 2×N — siehe
  // ladeBlNummernVor(). Der Schlüssel muss zeichengleich der sein, mit dem
  // fetchPartPrice unten aufgerufen wird, sonst greift das Gedächtnis daneben.
  await ladeBlNummernVor(manualParts.map(p => String(p.bl_part_number || p.part_number)));

  const acqByPart = await loadManualAcquisitions(uids, 'part', String(currency));

  const tasks = manualParts.map(part => async () => {
    // Marktpreis kommt immer live von BrickLink (globaler, geteilter Preiscache
    // mit TTL — analog zu Sets). Preis/Stk bzw. Kaufpreis beeinflussen nur die
    // G&V-Basis, nicht mehr den angezeigten Marktpreis/aktuellen Wert.
    //
    // NEU: je vorkommendem Zustand ein Preis, danach mengengewichtet
    // zusammengefasst — wie bei Sets (utils/setValue.ts). Vorher entschied ein
    // einzelner Zustand über den Wert ALLER Exemplare.
    const key    = `${part.part_number}|${part.color_id || 0}`;
    const acqs   = acqByPart.get(key) || [];
    // Der Zustand des STUECKS, nicht der Preisabfrage.
    // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computepartsvaluation-conds
    const conds  = conditionsOf(acqs);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      try {
        pd = await fetchPartPrice(part.bl_part_number || part.part_number, part.color_id || 0, cond, currency, ttlHours);
      } catch (e: any) {
        pd = { avg_price: 0, qty_avg_price: 0, error: e.message };
      }
      // avg_price zuerst: BrickLinks angezeigter "Avg Price". qty_avg_price ist
      // der mengengewichtete Schnitt und liegt systematisch darunter. Zusätzlich
      // ist "0.00" aus Postgres truthy und hätte avg_price verdeckt.
      const v = parseFloat(String(pd.avg_price || 0)) || parseFloat(String(pd.qty_avg_price || 0)) || 0;
      if (v > 0) priceMap.set(`${key}|${cond}`, v);
      if (!priceData || (!priceData.avg_price && v > 0)) priceData = pd;
    }

    const qty     = part.quantity || 1;
    // 'N' statt eines gespeicherten Zustands: Der Rueckfall greift nur ohne
    // Erfassungen, und dort gilt „Neu“ (siehe conditionsOf unten).
    const valued  = valueSet(key, acqs, priceMap, 'N', qty);
    const rows    = valueAcquisitionRows(key, acqs, priceMap);
    const unitVal = valued.unit_price ?? 0;
    const totalQty = acqs.length ? valued.quantity : qty;
    const acqPurchase = acqs.length ? weightedPurchase(rows) : null;
    // Kaufpreis wie bei den Figuren darueber (Migration 0035).
    const hasCost = acqs.length > 0;
    const purchasePrice = acqPurchase ?? 0;
    return {
      id:           part.id,
      // user_id gehoert in die Antwort, obwohl die Kachel keine Kontonummer
      // zeigt: withOwnerNames() weiter unten macht daraus `owners`, und ohne
      // das Feld tut es gar nichts (`r.user_id == null` -> Zeile unveraendert).
      // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computepartsvaluation
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
      // Der Einzelpreis der NEUESTEN Erfassung. Hier stand part.unit_price —
      // die Abschrift an der Bestandszeile, die Migration 0035 geloescht hat.
      // loadManualAcquisitions() ordnet aufsteigend nach created_at, also ist
      // der letzte Eintrag der neueste. Die Webapp nimmt ohnehin
      // avg_purchase_price zuerst (06-minifigs.js) und dieses Feld nur als
      // Rueckfall.
      unit_price:   acqs.length ? (acqs[acqs.length - 1].unit_price ?? null) : null,
      purchase_price: hasCost ? purchasePrice : null,
      condition:    valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions:   valued.by_condition.map(b => b.condition),
      // Eine Zeile je Kaufpreis — wie bei Sets.
      acquisitions: rows,
      pnl_pct:      hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      ...priceData,
      // Nach ...priceData, damit der gewichtete Wert den Einzelpreis des
      // zuletzt geholten Zustands überschreibt und nicht umgekehrt.
      avg_price:    unitVal,
      qty_avg_price: unitVal,
      total_value:  (unitVal * totalQty).toFixed(4),
      display_value: (unitVal * totalQty).toFixed(2),
    };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((sum, r) => sum + parseFloat(r.total_value || 0), 0);
  // `condition` faellt aus der Huelle weg.
  // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computepartsvaluation-2
  return { currency, parts: results, total_value: total.toFixed(2) };
}

/**
 * Zustände eines manuellen Eintrags — aus den Erfassungen.
 *
 * Ohne Erfassungen „Neu“: Den gespeicherten Wert der Stammzeile, der hier
 * einmal der Rueckfall war, gibt es seit Migration 0035 nicht mehr. Dieselbe
 * Regel wie conditionsFromAcquisitions() in utils/handlers/shared.ts.
 */
function conditionsOf(acqs: any[]): ('N' | 'U')[] {
  if (!acqs?.length) return ['N'];
  const set = new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

/**
 * Besitzer-Namen an Bewertungszeilen hängen — nur im Haushalt.
 *
 * Manuell erfasste Teile und Minifiguren werden bewusst NICHT verdichtet: Zwei
 * Konten mit demselben Teil sind zwei Bestände mit eigener Menge und eigenem
 * Kaufpreis. Ohne die Plakette sähe die Finanztabelle wie eine doppelte Zeile
 * aus.
 */
async function withOwnerNames(uids: number[], rows: any[]): Promise<any[]> {
  // Reicht durch: utils/handlers/shared.ts -> withOwners() beantwortet
  // dieselbe Frage und kann MEHR — dort wird auch `owner_ids` (die Liste aus
  // array_agg) zu Plaketten, hier stand nur der Einzelfall `user_id`. Zwei
  // Fassungen derselben Sache, von denen eine weniger konnte.
  //
  // Lazy require: utils/handlers/shared zieht die Handler nach sich, ein
  // Import auf Modulebene ergaebe einen Zyklus.
  const { withOwners } = require('../handlers/shared');
  return withOwners(uids, rows);
}

export { computeSetsValuation, computeMinifigsValuation, computePartsValuation };
