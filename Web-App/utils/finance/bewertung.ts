/**
 * BEWERTUNG: Was ist der Bestand heute wert — Sets, Minifiguren, Teile.
 *
 * Steht auf der Preisschicht (preise.ts) und wird von der Gewinnrechnung
 * (gewinnVerlust.ts) benutzt. Warum die drei getrennt sind, steht im Kopf von
 * preise.ts.
 */

import { meldeUndLiefere } from '../../src/infra/httpError';
import * as db from '../../db/database';
import { asIds } from '../../src/haushalt/haushalt';
import { getSetting, getGlobalSetting } from '../../src/konto/settings';
import { resolveImageLocal, proxyImageUrl } from '../images';
import { valueSet, valueAcquisitionRows, weightedPurchase, pnlPct as calcPnlPct, pnlProzent } from '../setValue';
import { mitVersion } from '../setNummer';
import { effectiveCondition } from './zustand';
import { mengeJoin, mengeAus } from '../bestandsmenge';
import {
  DEFAULT_PRICE_CONDITION, PRICE_CACHE_COLS, parallelLimit,
  fetchPrice, fetchPartPrice, fetchMinifigPrice, ladeBlNummernVor,
  ladeTeilepreiseVor, ladeFigurenpreiseVor,
  type Blickfeld,
} from './preise';
import { ladeSetErfassungen, kaufpreisSpalten, zaehle } from './abfragen';
import { schaetzeFigurenpreis } from '../marketPrice';
import { withOwners } from '../handlers/shared';
import { blJoin, blNummerSql } from '../blZuordnung';
import { teilmengeJoin, teilmengeAus } from '../bestandsmenge';
import { KEINE_FARBE } from '../../src/infra/validate';
import { aufRappen, inZehntel4 } from '../../src/infra/geld';

/**
 * Erfassungen manueller Teile bzw. Minifiguren, gruppiert nach Eintrag.
 * Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#loadmanualacquisitions
 * @param {'part'|'fig'} kind
 * @returns Map key → Erfassungszeilen; key ist `nummer|farbe` bzw. `nummer`
 */
async function loadManualAcquisitions(uid: Blickfeld, kind: 'part' | 'fig', waehrung: string) {
  // Blickfeld: Ein Hauptkonto bewertet den ganzen Haushalt. Die Währung ist
  // beim Verknüpfen erzwungen gleich (src/haushalt/haushalt.ts) — sonst summierte
  // diese Rechnung zwei Währungen, ohne dass man es der Zahl ansähe.
  const uids = asIds(uid as any);
  const rows = await db.all(
    kind === 'part'
      ? `SELECT id, part_number, color_id, quantity,
                ${kaufpreisSpalten('unit_price', '$2')}, currency, price_estimated,
                COALESCE(condition,'N') AS condition, created_at
           FROM part_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`
      : `SELECT id, fig_number, quantity,
                ${kaufpreisSpalten('unit_price', '$2')}, currency, price_estimated,
                COALESCE(condition,'N') AS condition, created_at
           FROM minifig_acquisitions WHERE user_id = ANY($1) ORDER BY created_at ASC, id ASC`,
    [uids, waehrung]
  ).catch(meldeUndLiefere('bewertung:rows', []));
  const out = new Map<string, any[]>();
  for (const r of rows) {
    const key = kind === 'part' ? `${r.part_number}|${r.color_id ?? KEINE_FARBE}` : String(r.fig_number);
    const list = out.get(key);
    if (list) list.push(r); else out.set(key, [r]);
  }
  return out;
}

/** Wie viele Kaufpreise in einer anderen Währung erfasst sind (und deshalb fehlen). */
function fremdeKaufpreise(jeEintrag: Map<string, Array<{ kaufpreis_fremd?: boolean }>>): number {
  let n = 0;
  for (const zeilen of jeEintrag.values()) n += zeilen.filter(z => z.kaufpreis_fremd).length;
  return n;
}

// ── Compute the price valuation for all of a user's sets ────────────────────
// Shared by the session route (/finance/valuation) and the token API
// (/api/v1/finance/valuation) so the logic exists exactly once.
async function computeSetsValuation(viewerId: number, ids: Blickfeld) {
  // viewerId bestimmt die Einstellungen, ids die gerechneten Daten: Mit dem
  // Filter „Unterkonten“ fehlt das fragende Konto in ids.
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
       ${mengeJoin('s', 'sm', '= ANY($1)')}
      WHERE s.user_id = ANY($1)`, [uids]);
  if (!sets.length) return { currency, condition: defaultCondition, guide_type: guideType, ttl_hours: ttlHours,
    ttl_stunden: Number(ttlHours) || 24, kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0, sets: [], totals: { min:'0.00', avg:'0.00', max:'0.00', qty_avg:'0.00' } };

  // Batch-Prefetch: Katalog-Flags, Preiscache (beide Zustände) und ALLE
  // Erfassungen in je einer Query — sonst wäre das eine Abfrage je Set.
  const ttl = Math.max(1, parseInt(String(ttlHours)));
  const setNumbers = sets.map(s => s.set_number);
  const [catRows, cacheRows, acqRows] = await Promise.all([
    // catalog_cache führt Nummern mit Versionsanhang (Migration 0074),
    // price_cache unter der Schreibweise des Aufrufers.
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
      // Grund für die Anzeige: BrickLink führt das Set (noch) nicht.
      bl_unbekannt: needed.some(c => priceByCond[c]?.bl_unbekannt === true),
      ...(failedAll ? { error: errors[0] } : {}),
    };
  });

  const results = await parallelLimit(tasks, 5);
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
    // Dieselbe Angabe als Zahl; ttl_hours bleibt für ältere Clients Text.
    ttl_stunden: Number(ttlHours) || 24,
    // Kaufpreise in einer anderen Währung fehlen in den Summen (Kurse gibt es
    // keine); die Zahl sagt, wie viele es sind, statt sie still wegzulassen.
    kaufpreise_fremde_waehrung: zaehle(acqRows, 'kaufpreis_fremd'),
    kaufpreise_umgerechnet: zaehle(acqRows, 'kaufpreis_umgerechnet'),
    sets: results,
    totals: { min: aufRappen(zMin).toFixed(2), avg: aufRappen(zAvg).toFixed(2), max: aufRappen(zMax).toFixed(2), qty_avg: aufRappen(zQtyAvg).toFixed(2) },
  };
}

// ── Compute valuation for all manually captured minifigs of a user ──────────
// Shared by the session route (/finance/minifigs-valuation) and the token API
// (/api/v1/finance/minifigs-valuation) so the logic exists exactly once.
async function computeMinifigsValuation(viewerId: number, ids: Blickfeld) {
  // viewerId bestimmt die Einstellungen, ids die gerechneten Daten: Mit dem
  // Filter „Unterkonten“ fehlt das fragende Konto in ids.
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
  if (!manualFigs.length) return { currency, figs: [], total_value: '0.00', kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0 };

  const acqByFig = await loadManualAcquisitions(uids, 'fig', String(currency));
  const figVorrat = await ladeFigurenpreiseVor(
    manualFigs.filter(f => f.bl_fig_number).map(f => String(f.bl_fig_number)), String(currency), ttlHours);

  const tasks = manualFigs.map(fig => async () => {
    // Marktpreis je vorkommendem Zustand (geteilter Preiscache wie bei Sets):
    // Ein neu gekauftes Exemplar bekommt den Neupreis, auch wenn ein anderes gebraucht ist.
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
        try { pd = await fetchMinifigPrice(fig.bl_fig_number, cond, currency, ttlHours, figVorrat); }
        catch (e: any) { pd = { avg_price: 0, qty_avg_price: 0, error: e.message }; }
      } else {
        // Keine BrickLink-Nummer hinterlegt: Marktpreis aus den einzelnen
        // BrickLink-Teilepreisen der Minifigur schätzen (Rebrickable→BrickLink-
        // Zuordnung existiert zuverlässig für Teile, nicht für Minifiguren).
        // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computeminifigsvaluation
        const s = await schaetzeFigurenpreis(fig.fig_number, viewerId, cond).catch(meldeUndLiefere('bewertung:schaetzeFigurenpreis', null));
        pd = s != null
          ? { avg_price: s.preis, qty_avg_price: s.preis, from_cache: false, estimated_from_parts: true, abdeckung: s.abdeckung }
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
    // Ein Kaufpreis gilt nur, wenn eine Erfassung einen in der Kontowährung
    // trägt. Fremde Währung und „kein Preis bekannt“ zählten sonst als 0, und
    // die G&V stand bei Zehntausenden Prozent; wie bei Sets heisst das „—“.
    const hasCost = acqPurchase != null;
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

// ── GET /api/finance/minifigs-valuation ───────────────────────────────────────
async function computePartsValuation(viewerId: number, ids: Blickfeld) {
  // viewerId bestimmt die Einstellungen, ids die gerechneten Daten: Mit dem
  // Filter „Unterkonten“ fehlt das fragende Konto in ids.
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

  if (!manualParts.length) return { currency, parts: [], total_value: '0.00', kaufpreise_fremde_waehrung: 0, kaufpreise_umgerechnet: 0 };

  // Die BrickLink-Nummern aller Teile in zwei Abfragen statt in 2×N — siehe
  // ladeBlNummernVor(). Der Schlüssel muss zeichengleich der sein, mit dem
  // fetchPartPrice unten aufgerufen wird, sonst greift das Gedächtnis daneben.
  await ladeBlNummernVor(manualParts.map(p => String(p.bl_part_number || p.part_number)));

  const acqByPart = await loadManualAcquisitions(uids, 'part', String(currency));
  const teilVorrat = await ladeTeilepreiseVor(manualParts.map(p => ({
    partNumber: String(p.bl_part_number || p.part_number), rbColorId: p.color_id ?? KEINE_FARBE })), String(currency), ttlHours);

  const tasks = manualParts.map(part => async () => {
    // Marktpreis je vorkommendem Zustand, mengengewichtet zusammengefasst wie
    // bei Sets (utils/setValue.ts).
    const key    = `${part.part_number}|${part.color_id ?? KEINE_FARBE}`;
    const acqs   = acqByPart.get(key) || [];
    // Der Zustand des STUECKS, nicht der Preisabfrage.
    // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computepartsvaluation-conds
    const conds  = conditionsOf(acqs);

    const priceMap = new Map<string, number>();
    let priceData: any = null;
    for (const cond of conds) {
      let pd: any;
      try {
        pd = await fetchPartPrice(part.bl_part_number || part.part_number, part.color_id ?? KEINE_FARBE, cond, currency, ttlHours, teilVorrat);
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
    // Kaufpreis wie bei den Figuren darüber.
    const hasCost = acqPurchase != null;
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
      // Einzelpreis der neuesten Erfassung (die Liste ist nach created_at
      // aufsteigend); die Webapp nimmt ihn nur als Rückfall.
      unit_price:   acqs.length ? (acqs[acqs.length - 1].unit_price ?? null) : null,
      purchase_price: hasCost ? purchasePrice : null,
      condition:    valued.by_condition.some(b => b.condition === 'U') ? 'U' : 'N',
      conditions:   valued.by_condition.map(b => b.condition),
      // Eine Zeile je Kaufpreis — wie bei Sets.
      acquisitions: rows,
      pnl_pct:      hasCost ? calcPnlPct(purchasePrice, unitVal) : null,
      pnl_prozent:  hasCost ? pnlProzent(purchasePrice, unitVal) : null,
      ...priceData,
      // Nach ...priceData, damit der gewichtete Wert den Einzelpreis des
      // zuletzt geholten Zustands überschreibt und nicht umgekehrt.
      avg_price:    unitVal,
      qty_avg_price: unitVal,
      total_value:  ((valued.unit_z ?? 0) * totalQty / 10000).toFixed(4),
      display_value: aufRappen((valued.unit_z ?? 0) * totalQty).toFixed(2),
      wert_gesamt:  aufRappen((valued.unit_z ?? 0) * totalQty),
    };
  });

  const results = await withOwnerNames(uids, await parallelLimit(tasks, 5));
  const total = results.reduce((sum, r) => sum + (inZehntel4(r.total_value) ?? 0), 0);
  // `condition` faellt aus der Huelle weg.
  // Ausführlich: docs/begruendungen/utils/finance/bewertung.ts.md#computepartsvaluation-2
  return { currency, parts: results, total_value: aufRappen(total).toFixed(2),
           kaufpreise_fremde_waehrung: fremdeKaufpreise(acqByPart),
           kaufpreise_umgerechnet: zaehle([...acqByPart.values()].flat(), 'kaufpreis_umgerechnet') };
}

/** Zustände eines manuellen Eintrags aus den Erfassungen; ohne Erfassung „Neu“ (wie conditionsFromAcquisitions()). */
function conditionsOf(acqs: any[]): ('N' | 'U')[] {
  if (!acqs?.length) return ['N'];
  const set = new Set(acqs.map(a => (a.condition === 'U' ? 'U' : 'N')));
  return (['N', 'U'] as const).filter(c => set.has(c));
}

/**
 * Besitzer-Namen an Bewertungszeilen hängen — nur im Haushalt. Manuelle
 * Einträge zweier Konten bleiben getrennte Zeilen; die Plakette unterscheidet sie.
 */
async function withOwnerNames(uids: number[], rows: any[]): Promise<any[]> {
  // Reicht durch: utils/handlers/shared.ts -> withOwners() beantwortet
  // dieselbe Frage und kann MEHR — dort wird auch `owner_ids` (die Liste aus
  // array_agg) zu Plaketten, hier stand nur der Einzelfall `user_id`. Zwei
  // Fassungen derselben Sache, von denen eine weniger konnte.
  return withOwners(uids, rows);
}

export { computeSetsValuation, computeMinifigsValuation, computePartsValuation };
