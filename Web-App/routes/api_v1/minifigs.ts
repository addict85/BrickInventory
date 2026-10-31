/** /api/v1/minifigs — CRUD und Teile-Liste (Erfassungen: ./acquisitions.ts). */
import express from 'express';
import { handleRouteError, pfadParam } from '../../src/infra/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget, writableIds } from '../../src/haushalt/haushalt';
import { getManualMinifigs, getMinifigStats, getMinifigs } from '../../src/figuren/abfragen';
import { addManualFig, updateManualFig, importiereFigurenCsv } from '../../src/figuren/manuelleFiguren';
import { getSetting } from '../../src/konto/settings';
import { getMinifigPriceHistory } from '../../src/finanzen/priceHistory';
import { einzelwert } from '../../src/infra/validate';
import { verwendendeSets } from '../../src/bestand/gemeinsam';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { normalisiereLagerort, setzeLagerort } from '../../src/bestand/lagerort';
import { loescheFigur } from '../../src/bestand/loeschen';
import { teileDerFigur } from '../../src/figuren/dienst';
import { csvEmpfang } from '../../src/infra/dateiEmpfang';
import { csvImportAntwort } from '../../src/infra/csvExport';
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

/**
 * PUT /api/v1/minifigs/:figNumber/storage — Lagerort setzen.
 * Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#put-minifigs-fignumber-storage
 */
router.put('/minifigs/:figNumber/storage', requireToken, async (req: AuthedRequest, res) => {
  try {
    const ort = normalisiereLagerort(req.body?.storage);
    const n = await setzeLagerort('fig', await writableIds(req.apiUser.user_id),
      [pfadParam(req, 'figNumber')], ort);
    res.json({ success: true, storage: ort, changed: n });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── DELETE /api/v1/minifigs/:figNumber — delete a manual minifig ─────────────
router.delete('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Wie bei den Teilen: Ohne den Parameter das eigene Konto.
    const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
    if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
    const geloescht = await loescheFigur(besitzer, String(req.params.figNumber));
    if (geloescht === null) return sendeFehler(req, res, 404, 'minifig_nicht_manuell');
    res.json({ success: true, papierkorb: [geloescht] });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Manuell erfasste Minifiguren — gleicher Handler wie /api/minifigs/manual.
router.get('/minifigs/manual', requireToken, async (req: AuthedRequest, res) => {
  try {
    // `search` wie bei /parts/manual — und aus demselben Grund nur dieses Feld.
    res.json({ success: true, figs: await getManualMinifigs(
      await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)),
      req.apiUser.user_id,
      { search: einzelwert(req.query.search) }) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/minifigs/stats ───────────────────────────────────────────────
/**
 * Kennzahlen des Minifiguren-Reiters. Die Zählung steht in utils/handlers.ts
 * und benutzt dieselbe Gruppierung wie die Liste — vorher hatte die Webapp
 * eine eigene Abfrage (ohne Blickfeld, mit anderer Gruppierung) und die App
 * rechnete aus ihrer geladenen Liste.
 * Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#get-minifigs-stats
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
  try { res.json({ success: true, ...await teileDerFigur(String(req.params.figNumber)) }); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/minifigs/import/csv ────────────────────────────────────────
router.post('/minifigs/import/csv', requireToken, csvEmpfang.single('file'), async (req: AuthedRequest & { file?: { buffer: Buffer } }, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  try {
    csvImportAntwort(res, await importiereFigurenCsv(req.apiUser.user_id, req.file.buffer.toString('utf-8')));
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/minifigs/:figNumber/sets ─────────────────────────────────────
/**
 * In welchen Sets steckt diese Figur?
 * Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#get-minifigs-fignumber-sets
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
