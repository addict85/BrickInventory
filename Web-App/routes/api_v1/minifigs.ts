/** /api/v1/minifigs — CRUD und Teile-Liste (Erfassungen: ./acquisitions.ts). */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError, pfadParam } from '../../utils/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { getManualMinifigs, getMinifigStats, getMinifigs } from '../../utils/handlers/minifigs';
import { addManualFig, updateManualFig } from '../minifigs';
import { getSetting } from '../../utils/settings';
import { getMinifigPriceHistory } from '../../utils/priceHistory';
import { einzelwert } from '../../utils/validate';
const router = express.Router();

// ── MINIFIGS ─────────────────────────────────────────────────────────────────
router.get('/minifigs', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
    const r = await getMinifigs(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
    res.json({ success: true, figs: r.figs, total: r.total });
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/v1/minifigs — add a single manual minifig (same logic as web app)
router.post('/minifigs', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return res.status(403).json({ success: false, error: 'Kein Schreibrecht für dieses Konto.' });
    const result = await addManualFig(owner, req.body);
    res.json({ success: true, ...result });
  } catch (e) { handleRouteError(res, e); }
});

// ── PUT /api/v1/minifigs/:figNumber — edit quantity / Preis/Stk (same logic as web app)
router.put('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Wie bei den Teilen: Ohne den Parameter das eigene Konto.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return res.status(403).json({ success: false, error: 'Kein Zugriff auf dieses Konto' });
    await updateManualFig(besitzer, pfadParam(req, 'figNumber'), req.body);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

// ── DELETE /api/v1/minifigs/:figNumber — delete a manual minifig ─────────────
router.delete('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Wie bei den Teilen: Ohne den Parameter das eigene Konto.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return res.status(403).json({ success: false, error: 'Kein Zugriff auf dieses Konto' });
    const r = await db.run(
      "DELETE FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
      [besitzer, req.params.figNumber]);
    if (r.changes === 0) return res.status(404).json({ success: false, error: 'Minifigur nicht gefunden oder nicht manuell hinzugefügt' });
    // OHNE .catch(() => {}) — siehe Session-Route: verwaiste Erfassungen
    // zählen in den Finanzsummen weiter, ohne dass eine Ansicht sie zeigt.
    await db.run('DELETE FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2',
      [besitzer, req.params.figNumber]);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

// Manuell erfasste Minifiguren — gleicher Handler wie /api/minifigs/manual.
router.get('/minifigs/manual', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, figs: await getManualMinifigs(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
  } catch (e) { handleRouteError(res, e); }
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
  } catch (e) { handleRouteError(res, e); }
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
  } catch (e) { handleRouteError(res, e); }
});

router.get('/minifigs/:figNumber/parts', requireToken, async (req: AuthedRequest, res) => {
  const figNumber = req.params.figNumber;
  try {
    // Look up in rb_inventories (minifigs are stored as sets with fig- prefix)
    const inv = await db.get(
      `SELECT id FROM rb_inventories WHERE set_num = $1 OR set_num = $2 ORDER BY version DESC LIMIT 1`,
      [figNumber, String(figNumber).replace('fig-', '')]
    ).catch(() => null);

    if (!inv) return res.json({ success: true, parts: [], source: 'not_found' });

    // Get CSV parts for this minifig
    const csvParts = await db.all(
      `SELECT ip.part_num AS part_number,
              COALESCE(m.bl_part_num, ip.part_num) AS bl_part_number,
              p.name AS part_name, ip.color_id,
              c.name AS color_name, c.rgb AS color_hex,
              CASE WHEN ip.is_spare='t' THEN 1 ELSE 0 END AS is_spare,
              ip.quantity
       FROM rb_inventory_parts ip
       LEFT JOIN rb_parts  p ON p.part_num = ip.part_num
       LEFT JOIN rb_colors c ON c.id       = ip.color_id
       LEFT JOIN rb_bl_mapping m ON m.part_num = ip.part_num
       WHERE ip.inventory_id = $1`,
      [inv.id]
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
  } catch (e) { handleRouteError(res, e); }
});


export default router;
