/** /api/v1/parts — CRUD, Farben, Statistiken (Erfassungen: ./acquisitions.ts). */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { getBlColorMap, getManualParts, getOwnedQuantities, getParts, getPartsColors, getPartsStats } from '../../utils/handlers/parts';
import { addManualPart, getPartColorList, updateManualPart } from '../parts';
import { getSetting } from '../../utils/settings';
import { getPartPriceHistory } from '../../utils/priceHistory';
import { einzelwert } from '../../utils/validate';
import * as V from '../../utils/validate';
import { aendereTeilFarbe } from '../../utils/teilFarbeAendern';
import { verwendendeSets, loescheManuellesTeil } from '../../utils/handlers/shared';
import { sendeFehler } from '../../utils/fehlerTexte';
import { normalisiereLagerort, setzeLagerort } from '../../utils/lagerort';
import { writableIds } from '../../utils/household';
import { legeInPapierkorb } from '../../utils/papierkorb';
const router = express.Router();

// ── PARTS ─────────────────────────────────────────────────────────────────────
router.get('/parts', requireToken, async (req: AuthedRequest, res) => {
  try {
    const result = await getParts(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
    // page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.
    // Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#get-parts
    res.json({ success: true, page: parseInt(String(req.query.page||1)), ...result });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/parts/brick-colors — full brick color list for the add-part color picker (same logic as web app) ───────
router.get('/parts/brick-colors', requireToken, async (_req: AuthedRequest, res) => {
  try {
    const colors = await getPartColorList();
    res.json({ success: true, colors });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// ── POST /api/v1/parts — add a single manual part (same logic as web app) ─────
router.post('/parts', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Kontoauswahl beim Erfassen — wie in der Webapp. Ohne Angabe das eigene
    // Konto; resolveWriteTarget prüft die RICHTUNG (Hauptkonto → eigenes
    // Unterkonto), nicht bloss die Mitgliedschaft im Blickfeld.
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const result = await addManualPart(owner, req.body);
    res.json({ success: true, ...result });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── PUT /api/v1/parts/:partNumber/:colorId — edit quantity / Preis/Stk (same logic as web app)
router.put('/parts/:partNumber/:colorId', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Wie beim Loeschen: Die Ansicht sagt, wessen Karte gemeint ist.
    // NACHGEMESSEN — das Hauptkonto setzte auf der Karte des Kindes die Menge
    // auf 99, und geaendert wurde die EIGENE Zeile: vorher 5|9, nachher 99|9,
    // Antwort 200 {"success":true}.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
    await updateManualPart(besitzer, String(req.params.partNumber), parseInt(String(req.params.colorId)), req.body);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * PUT /api/v1/parts/:partNumber/:colorId/color — die Farbe nachträglich ändern.
 * Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#put-parts-partnumber-colorid-color
 */
router.put('/parts/:partNumber/:colorId/color', requireToken, async (req: AuthedRequest, res) => {
  try {
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
    // Die neue Farbe muss DASTEHEN. V.colorId() macht aus fehlend/unsinnig
    // eine 0, und 0 ist eine Farbe („ohne Angabe") — beim Korrigieren wäre
    // das ein stilles Leeren mit Erfolgsmeldung.
    const roh = req.body?.color_id;
    const neueFarbe = parseInt(String(roh ?? ''), 10);
    if (roh === undefined || roh === null || String(roh).trim() === ''
        || !Number.isFinite(neueFarbe) || neueFarbe < 0) {
      return sendeFehler(req, res, 400, 'farbe_erforderlich');
    }
    const ergebnis = await aendereTeilFarbe(
      besitzer, String(req.params.partNumber),
      parseInt(String(req.params.colorId)) || 0,
      neueFarbe,
      { color_name: V.optionalText(req.body?.color_name, 100),
        color_hex:  V.optionalHex(req.body?.color_hex) });
    res.json({ success: true, ...ergebnis });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── DELETE /api/v1/parts/:partNumber/:colorId — delete a manual part ─────────
router.delete('/parts/:partNumber/:colorId', requireToken, async (req: AuthedRequest, res) => {
  try {
    // WESSEN Karte war gemeint? Ohne den Parameter das eigene Konto — also
    // unverändert für jeden Client, der ihn nicht kennt.
    //
    // resolveWriteTarget() ist derselbe Helfer, den das ERFASSEN schon nutzt
    // (owner_user_id): Die Ansicht sagt, wessen Zeile gemeint ist; ob das
    // erlaubt ist, entscheidet der Server über canWriteFor() — nie der Client.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
    const pn = String(req.params.partNumber), cid = parseInt(String(req.params.colorId));
    const geloescht = await db.transaction(async (tx) => {
      const id = await legeInPapierkorb(tx, 'teil', besitzer, pn, cid);
      const r = await loescheManuellesTeil(tx, besitzer, pn, cid);
      if (r.changes === 0) return null;
      // Erfassungen mitlöschen: Die Finanzsummen lesen sie und zählten das
      // gelöschte Teil sonst weiter.
      await tx.run('DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3',
        [besitzer, pn, cid || 0]);
      return id;
    });
    if (geloescht === null) return sendeFehler(req, res, 404, 'teil_nicht_manuell');
    res.json({ success: true, papierkorb: [geloescht] });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/parts/bl-color-map — Rebrickable color_id → BrickLink color_id
router.get('/parts/bl-color-map', requireToken, async (_req: AuthedRequest, res) => {
  try {
    const result = await getBlColorMap();
    res.json({ success: true, ...result });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// Manuell erfasste Teile — gleicher Handler wie /api/parts/manual (Parität;
// bisher fehlte diese Information in der Android-API komplett).
/**
 * POST /api/v1/parts/owned — „was davon habe ich schon?"
 * Nimmt die Teile EINER Teileliste entgegen und antwortet je Teil-Farb-Paar
 * mit zwei Zahlen: `gesamt` (alles im Blickfeld) und `lose` (nur, was nicht in
 * einem Set steckt). Welche gilt, entscheidet der Mensch — siehe die …
 * Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#post-parts-owned
 */
router.post('/parts/owned', requireToken, async (req: AuthedRequest, res) => {
  try {
    const teile = Array.isArray(req.body?.teile) ? req.body.teile : [];
    const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    res.json({ success: true, bestand: await getOwnedQuantities(ids, teile) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * PUT /api/v1/parts/:partNumber/:colorId/storage — Lagerort setzen.
 *
 * Trifft ALLE Zeilen des Teil-Farb-Paares im Schreibbereich: Dasselbe Teil
 * steckt in mehreren Sets und damit in mehreren Zeilen. Wer in der Ansicht
 * „Kiste 3" eintraegt, meint das Teil, nicht eine seiner Zeilen — und haette
 * sonst je Set einen eigenen Ort zu pflegen.
 */
router.put('/parts/:partNumber/:colorId/storage', requireToken, async (req: AuthedRequest, res) => {
  try {
    const ort = normalisiereLagerort(req.body?.storage);
    const n = await setzeLagerort('part', await writableIds(req.apiUser.user_id),
      [String(req.params.partNumber), String(parseInt(String(req.params.colorId)) || 0)], ort);
    res.json({ success: true, storage: ort, changed: n });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/parts/manual', requireToken, async (req: AuthedRequest, res) => {
  try {
    // NUR `search` wird durchgereicht, nicht req.query als Ganzes: Die Liste
    // antwortet hier ohne Blaetterung (die Webapp zeigt alle manuellen Teile in
    // einem Raster), und ein durchgereichtes page_size wuerde sie unbemerkt
    // deckeln. Der Suchtext kommt aus derselben Filterleiste wie bei den
    // Set-Teilen — die Begruendung steht an getManualParts.
    res.json({ success: true, parts: await getManualParts(
      await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)),
      req.apiUser.user_id,
      { search: einzelwert(req.query.search), storage: einzelwert(req.query.storage) }) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/parts/colors', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Gemeinsamer Handler (auch /api/parts/colors): ohne manuelle Positionen,
    // mit rb_colors-Hex-Fallback (Parität zur Webapp).
    res.json({ success:true, colors: await getPartsColors(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/parts/stats', requireToken, async (req: AuthedRequest, res) => {
  try {
    const stats = await getPartsStats(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, stats });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});


// ── GET /api/v1/parts/:partNumber/:colorId/price-history ─────────────────────
/**
 * Preisverlauf eines manuell erfassten Teils, je Zustand getrennt.
 * Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#get-parts-partnumber-colorid-price-history
 */
router.get('/parts/:partNumber/:colorId/price-history', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uid = req.apiUser.user_id;
    const currency = await getSetting(uid, 'currency', 'EUR');
    const data = await getPartPriceHistory(
      await scopeIds(uid, parseScopeMode(req.query.accounts)), einzelwert(req.params.partNumber), parseInt(String(req.params.colorId)) || 0, currency);
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/parts/:partNumber/:colorId/sets ──────────────────────────────
/**
 * In welchen Sets steckt dieses Teil?
 * Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#get-parts-partnumber-colorid-sets
 */
router.get('/parts/:partNumber/:colorId/sets', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    const { item, sets } = await verwendendeSets(uids, 'parts', {
      part_number: einzelwert(req.params.partNumber),
      color_id: parseInt(String(req.params.colorId)) || 0,
    });
    res.json({ success: true, item, sets });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
