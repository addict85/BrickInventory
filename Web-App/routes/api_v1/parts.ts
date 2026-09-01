/** /api/v1/parts — CRUD, Farben, Statistiken (Erfassungen: ./acquisitions.ts). */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { getBlColorMap, getManualParts, getParts, getPartsColors, getPartsStats } from '../../utils/handlers/parts';
import { addManualPart, getPartColorList, updateManualPart } from '../parts';
import { getSetting } from '../../utils/settings';
import { getPartPriceHistory } from '../../utils/priceHistory';
import { einzelwert } from '../../utils/validate';
const router = express.Router();

// ── PARTS ─────────────────────────────────────────────────────────────────────
router.get('/parts', requireToken, async (req: AuthedRequest, res) => {
  try {
    const result = await getParts(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
    // page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.
    //
    // Vorher spiegelte die Antwort die Anfrage zurück. Die Set-Detailansicht
    // der App fragt 2000, bekam 500 gedeckelt — und las in der Antwort
    // „page_size: 2000". Damit konnte kein Client merken, dass Teile fehlen.
    // Der tatsächliche Wert steht jetzt drin; zusammen mit `total` lässt sich
    // ablesen, ob eine weitere Seite nötig ist.
    // `...result` bringt page_size selbst mit — ausdrücklich davorgestellt war
    // es wirkungslos (der Spread überschrieb es mit demselben Wert). Es hier
    // stehen zu lassen liest sich, als sicherte die Zeile etwas zu, was in
    // Wahrheit an getParts hängt.
    res.json({ success: true, page: parseInt(String(req.query.page||1)), ...result });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/v1/parts/brick-colors — full brick color list for the add-part color picker (same logic as web app) ───────
router.get('/parts/brick-colors', requireToken, async (_req: AuthedRequest, res) => {
  try {
    const colors = await getPartColorList();
    res.json({ success: true, colors });
  } catch (e) { handleRouteError(res, e); }
});

// ── POST /api/v1/parts — add a single manual part (same logic as web app) ─────
router.post('/parts', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Kontoauswahl beim Erfassen — wie in der Webapp. Ohne Angabe das eigene
    // Konto; resolveWriteTarget prüft die RICHTUNG (Hauptkonto → eigenes
    // Unterkonto), nicht bloss die Mitgliedschaft im Blickfeld.
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return res.status(403).json({ success: false, error: 'Kein Schreibrecht für dieses Konto.' });
    const result = await addManualPart(owner, req.body);
    res.json({ success: true, ...result });
  } catch (e) { handleRouteError(res, e); }
});

// ── PUT /api/v1/parts/:partNumber/:colorId — edit quantity / Preis/Stk (same logic as web app)
router.put('/parts/:partNumber/:colorId', requireToken, async (req: AuthedRequest, res) => {
  try {
    await updateManualPart(req.apiUser.user_id, String(req.params.partNumber), parseInt(String(req.params.colorId)), req.body);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

// ── DELETE /api/v1/parts/:partNumber/:colorId — delete a manual part ─────────
router.delete('/parts/:partNumber/:colorId', requireToken, async (req: AuthedRequest, res) => {
  try {
    const r = await db.run(
      "DELETE FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
      [req.apiUser.user_id, String(req.params.partNumber), parseInt(String(req.params.colorId))]
    );
    if (r.changes === 0) return res.status(404).json({ success: false, error: 'Teil nicht gefunden oder nicht manuell hinzugefügt' });
    // Erfassungshistorie mitlöschen — sonst tauchen die alten Preise beim
    // erneuten Hinzufügen desselben Teils wieder auf.
    // OHNE .catch(() => {}): Stammzeile weg, Erfassungen bleiben — die
    // Finanzsummen lesen die Erfassungen und hätten das gelöschte Teil
    // dauerhaft weitergezählt. Gleiche Änderung in der Session-Route.
    await db.run('DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3',
      [req.apiUser.user_id, String(req.params.partNumber), parseInt(String(req.params.colorId)) || 0]);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/v1/parts/bl-color-map — Rebrickable color_id → BrickLink color_id
router.get('/parts/bl-color-map', requireToken, async (_req: AuthedRequest, res) => {
  try {
    const result = await getBlColorMap();
    res.json({ success: true, ...result });
  } catch (e) { handleRouteError(res, e); }
});

// Manuell erfasste Teile — gleicher Handler wie /api/parts/manual (Parität;
// bisher fehlte diese Information in der Android-API komplett).
router.get('/parts/manual', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, parts: await getManualParts(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
  } catch (e) { handleRouteError(res, e); }
});

router.get('/parts/colors', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Gemeinsamer Handler (auch /api/parts/colors): ohne manuelle Positionen,
    // mit rb_colors-Hex-Fallback (Parität zur Webapp).
    res.json({ success:true, colors: await getPartsColors(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
  } catch (e) { handleRouteError(res, e); }
});

router.get('/parts/stats', requireToken, async (req: AuthedRequest, res) => {
  try {
    const stats = await getPartsStats(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, stats });
  } catch (e) { handleRouteError(res, e); }
});


// ── GET /api/v1/parts/:partNumber/:colorId/price-history ─────────────────────
/**
 * Preisverlauf eines manuell erfassten Teils, je Zustand getrennt.
 *
 * Gegenstück zu /api/finance/part-price-history — dieselbe Umsetzung
 * (utils/priceHistory.ts), damit beide Clients dieselbe Antwort sehen. Vorher
 * gab es den Verlauf NUR für die Webapp; der Detail-Dialog der App zeigte
 * deshalb weder Marktpreis je Zustand noch ein Diagramm.
 *
 * Die Route steht bewusst GANZ UNTEN: Express probiert der Reihe nach, und ein
 * Muster mit zwei Platzhaltern würde sonst auch auf feste Pfade wie
 * /parts/manual passen, sobald dort ein zweites Segment stünde.
 */
router.get('/parts/:partNumber/:colorId/price-history', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uid = req.apiUser.user_id;
    const currency = await getSetting(uid, 'currency', 'EUR');
    const data = await getPartPriceHistory(
      await scopeIds(uid, parseScopeMode(req.query.accounts)), einzelwert(req.params.partNumber), parseInt(String(req.params.colorId)) || 0, currency);
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e); }
});

export default router;
