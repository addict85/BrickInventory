/** /api/v1/minifigs — CRUD und Teile-Liste (Erfassungen: ./acquisitions.ts). */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError, pfadParam } from '../../utils/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { getManualMinifigs, getMinifigStats, getMinifigs } from '../../utils/handlers/minifigs';
import { addManualFig, updateManualFig } from '../minifigs';
import { getSetting } from '../../utils/settings';
import { ersatzteilSql } from '../../utils/validate';
import { getMinifigPriceHistory } from '../../utils/priceHistory';
import { einzelwert } from '../../utils/validate';
import { verwendendeSets, loescheManuelleFigur } from '../../utils/handlers/shared';
import { inventarNachKandidaten } from '../../utils/rbInventar';
import { sendeFehler } from '../../utils/fehlerTexte';
const router = express.Router();

// ── MINIFIGS ─────────────────────────────────────────────────────────────────
router.get('/minifigs', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
    const r = await getMinifigs(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
    res.json({ success: true, figs: r.figs, total: r.total });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/minifigs — add a single manual minifig (same logic as web app)
router.post('/minifigs', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const result = await addManualFig(owner, req.body);
    res.json({ success: true, ...result });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── PUT /api/v1/minifigs/:figNumber — edit quantity / Preis/Stk (same logic as web app)
router.put('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Wie bei den Teilen: Ohne den Parameter das eigene Konto.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
    await updateManualFig(besitzer, pfadParam(req, 'figNumber'), req.body);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── DELETE /api/v1/minifigs/:figNumber — delete a manual minifig ─────────────
router.delete('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Wie bei den Teilen: Ohne den Parameter das eigene Konto.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
    const r = await loescheManuelleFigur(db, besitzer, String(req.params.figNumber));
    if (r.changes === 0) return sendeFehler(req, res, 404, 'minifig_nicht_manuell');
    // OHNE .catch(() => {}) — siehe Session-Route: verwaiste Erfassungen
    // zählen in den Finanzsummen weiter, ohne dass eine Ansicht sie zeigt.
    await db.run('DELETE FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2',
      [besitzer, req.params.figNumber]);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Manuell erfasste Minifiguren — gleicher Handler wie /api/minifigs/manual.
router.get('/minifigs/manual', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, figs: await getManualMinifigs(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/minifigs/stats ───────────────────────────────────────────────
/**
 * Kennzahlen des Minifiguren-Reiters. Die Zählung steht in utils/handlers.ts
 * und benutzt dieselbe Gruppierung wie die Liste — vorher hatte die Webapp
 * eine eigene Abfrage (ohne Blickfeld, mit anderer Gruppierung) und die App
 * rechnete aus ihrer geladenen Liste.
 *
 * Die Route steht VOR /minifigs/:figNumber/… — sonst nähme Express `stats`
 * für eine Figurennummer.
 */
router.get('/minifigs/stats', requireToken, async (req: AuthedRequest, res) => {
  try {
    const stats = await getMinifigStats(
      await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, stats });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/minifigs/:figNumber/price-history ────────────────────────────
/** Wie /api/v1/parts/…/price-history, für Minifiguren (ohne Farbe). */
router.get('/minifigs/:figNumber/price-history', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uid = req.apiUser.user_id;
    const currency = await getSetting(uid, 'currency', 'EUR');
    // Blickfeld wie bei /parts/:nummer/:farbe/price-history — ohne scopeIds()
    // fand conditionRows() für eine Minifigur des Unterkontos keine Erfassung
    // und lieferte gar keine Zeile.
    const data = await getMinifigPriceHistory(
      await scopeIds(uid, parseScopeMode(req.query.accounts)), einzelwert(req.params.figNumber), currency);
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/minifigs/:figNumber/parts', requireToken, async (req: AuthedRequest, res) => {
  const figNumber = req.params.figNumber;
  try {
    // Look up in rb_inventories (minifigs are stored as sets with fig- prefix)
    // Figuren haben keinen Versionsanhang, sondern ein 'fig-' davor —
    // deshalb eigene Kandidaten, aber dieselbe Abfrage.
    const invId = await inventarNachKandidaten(
      [String(figNumber), String(figNumber).replace('fig-', '')]).catch(() => null);

    if (!invId) return res.json({ success: true, parts: [], source: 'not_found' });

    // Get CSV parts for this minifig
    const csvParts = await db.all(
      `SELECT ip.part_num AS part_number,
              COALESCE(m.bl_part_num, ip.part_num) AS bl_part_number,
              p.name AS part_name, ip.color_id,
              c.name AS color_name, c.rgb AS color_hex,
              -- Dieselbe Lesart wie istErsatzteil() in utils/validate.ts.
              -- Vorher nur 't' — ein '1' oder 'true' aus dem Katalog galt hier
              -- als KEIN Ersatzteil, drei Dateien weiter aber als eines.
              ${ersatzteilSql('ip.is_spare')} AS is_spare,
              ip.quantity
       FROM rb_inventory_parts ip
       LEFT JOIN rb_parts  p ON p.part_num = ip.part_num
       LEFT JOIN rb_colors c ON c.id       = ip.color_id
       LEFT JOIN rb_bl_mapping m ON m.part_num = ip.part_num
       WHERE ip.inventory_id = $1`,
      [invId]
    ).catch(() => []);

    // Check catalog — if empty, enrich NOW (get correct BL IDs before responding)
    let catRows = await db.all(
      `SELECT part_number, color_id, bl_part_number, image_url, image_local
       FROM set_parts_catalog WHERE set_number=$1`,
      [figNumber]
    ).catch(() => []);

    // Check if BL IDs are missing
    const needsEnrich = catRows.length === 0 ||
      catRows.some(r => !r.bl_part_number || r.bl_part_number === r.part_number);
    if (needsEnrich) {
      // Find which set this minifig belongs to, then enrich ALL minifigs of that set at once
      const parentSet = await db.get(
        `SELECT set_number FROM set_minifigs_catalog WHERE fig_number=$1 LIMIT 1`,
        [figNumber]
      ).catch(() => null);

      if (parentSet?.set_number) {
        // Enrich all minifigs of the parent set in one batch API call
        await require('../../jobs/partsCatalogEnrich').enrichSetMinifigs(parentSet.set_number).catch(() => {});
      } else {
        // Fallback: enrich this minifig individually
        await require('../../jobs/partsCatalogEnrich').enrichSetParts(figNumber).catch(() => {});
      }

      catRows = await db.all(
        `SELECT part_number, color_id, bl_part_number, image_url, image_local
         FROM set_parts_catalog WHERE set_number=$1`,
        [figNumber]
      ).catch(() => []);
    }

    const catalogMap: any = {};
    for (const r of catRows) catalogMap[`${r.part_number}|${r.color_id}`] = r;

    // Merge: catalog BL IDs take priority (from API), fallback to rb_bl_mapping
    const enriched = csvParts.map(p => {
      const cat = catalogMap[`${p.part_number}|${p.color_id}`] || {};
      return {
        ...p,
        bl_part_number: cat.bl_part_number || p.bl_part_number,
        image_url:      cat.image_local    || cat.image_url    || null,
      };
    });

    res.json({ success: true, parts: enriched, source: catRows.length ? 'enriched' : 'csv_cache' });
    // Download images in background
    setImmediate(() => require('../../jobs/partsCatalogEnrich').downloadSetImages(figNumber).catch(() => {}));
  } catch (e) { handleRouteError(res, e, undefined, req); }
});


// ── GET /api/v1/minifigs/:figNumber/sets ─────────────────────────────────────
/**
 * In welchen Sets steckt diese Figur?
 *
 * Gegenstück zu /api/v1/parts/:partNumber/:colorId/sets. Beide rufen dieselbe
 * Funktion in utils/handlers/shared.ts auf — die Frage ist zweimal dieselbe,
 * nur Tabelle und Schlüssel wechseln. Zwei getrennte Abfragen waeren genau die
 * Sorte Doppelung, die in diesem Projekt schon mehrfach auseinandergelaufen
 * ist (zuletzt routes/minifigs.ts gegen routes/parts.ts).
 *
 * Blickfeld, nicht eigenes Konto: Im Haushalt soll auch das Set des
 * Geschwisterkontos auftauchen, in dem dieselbe Figur steckt.
 */
router.get('/minifigs/:figNumber/sets', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    const { item, sets } = await verwendendeSets(uids, 'minifigs', {
      fig_number: einzelwert(req.params.figNumber),
    });
    res.json({ success: true, item, sets });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
