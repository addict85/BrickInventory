import { fehlerAntwort } from '../../src/infra/httpError';
import { requireToken, kontoSchranke } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { getBlColorMap, getManualParts, getOwnedQuantities, getParts, getPartsColors, getPartsStats, getPartsCategories } from '../../src/teile/abfragen';
import { csvEmpfang } from '../../src/infra/dateiEmpfang';
import { csvImportAntwort } from '../../src/infra/csvExport';
import { addManualPart, getPartColorList, updateManualPart, importiereTeileCsv } from '../../src/teile/manuelleTeile';
import { getSetting } from '../../src/konto/settings';
import { getPartPriceHistory } from '../../src/finanzen/priceHistory';
import { einzelwert } from '../../src/infra/validate';
import * as V from '../../src/infra/validate';
import { aendereTeilFarbe } from '../../src/teile/teilFarbeAendern';
import { verwendendeSets } from '../../src/bestand/gemeinsam';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { normalisiereLagerort, setzeLagerort } from '../../src/bestand/lagerort';
import { writableIds } from '../../src/haushalt/haushalt';
import { loescheTeil } from '../../src/bestand/loeschen';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

router.get('/parts', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts'>) => {
  const result = await getParts(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
  // page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.
  res.json({ success: true, page: parseInt(String(req.query.page||1)), ...result });
});

router.get('/parts/categories', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/categories'>) => {
  // Dasselbe Blickfeld wie die Farbliste, sonst filtern zwei Listen derselben
  // Ansicht über verschiedene Konten.
  const uids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  res.json({ success: true, categories: await getPartsCategories(uids) });
});

router.post('/parts/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'), async (req: AuthedRequest & { file?: { buffer: Buffer } }, res: Antwort<'POST /api/v1/parts/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  csvImportAntwort(res, await importiereTeileCsv(req.apiUser.user_id, req.file.buffer.toString('utf-8')));
});

router.get('/parts/brick-colors', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/parts/brick-colors'>) => {
  const colors = await getPartColorList();
  res.json({ success: true, colors });
});

router.post('/parts', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/parts'>) => {
  // resolveWriteTarget prüft die RICHTUNG (Hauptkonto → eigenes Unterkonto),
  // nicht bloss die Mitgliedschaft im Blickfeld.
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const result = await addManualPart(owner, req.body);
  res.json({ success: true, ...result });
});

router.put('/parts/:partNumber/:colorId', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/parts/:partNumber/:colorId'>) => {
  // Die Ansicht sagt, wessen Karte gemeint ist; ohne Parameter änderte das
  // Hauptkonto auf der Karte des Kindes die eigene Zeile.
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  // Mit Mengenänderung trägt die Antwort die Menge danach (bei quantity_delta
  // weiss der Client sie sonst nicht).
  const r = await updateManualPart(besitzer, String(req.params.partNumber), V.colorId(req.params.colorId), req.body);
  res.json({ success: true, ...r });
});

// Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#put-parts-partnumber-colorid-color
router.put('/parts/:partNumber/:colorId/color', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/parts/:partNumber/:colorId/color'>) => {
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  // Die neue Farbe muss dastehen: V.colorId() machte aus fehlend „keine Farbe",
  // ein stilles Leeren mit Erfolgsmeldung.
  const roh = req.body?.color_id;
  const neueFarbe = parseInt(String(roh ?? ''), 10);
  if (roh === undefined || roh === null || String(roh).trim() === ''
      || !Number.isFinite(neueFarbe) || neueFarbe < 0) {
    return sendeFehler(req, res, 400, 'farbe_erforderlich');
  }
  const ergebnis = await aendereTeilFarbe(
    besitzer, String(req.params.partNumber),
    V.colorId(req.params.colorId),
    neueFarbe,
    { color_name: V.optionalText(req.body?.color_name, 100),
      color_hex:  V.optionalHex(req.body?.color_hex) });
  res.json({ success: true, ...ergebnis });
});

router.delete('/parts/:partNumber/:colorId', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/parts/:partNumber/:colorId'>) => {
  // Ohne Parameter das eigene Konto — unverändert für Clients, die ihn nicht kennen.
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  const geloescht = await loescheTeil(besitzer, String(req.params.partNumber), V.colorId(req.params.colorId));
  if (geloescht === null) return sendeFehler(req, res, 404, 'teil_nicht_manuell');
  res.json({ success: true, papierkorb: [geloescht] });
});

router.get('/parts/bl-color-map', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/parts/bl-color-map'>) => {
  const result = await getBlColorMap();
  res.json({ success: true, ...result });
});

/** Je Teil-Farb-Paar `gesamt` (Blickfeld) und `lose` (nicht in einem Set);
 * welche Zahl gilt, entscheidet der Mensch.
 * Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#post-parts-owned */
router.post('/parts/owned', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/parts/owned'>) => {
  const teile = Array.isArray(req.body?.teile) ? req.body.teile : [];
  const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  res.json({ success: true, bestand: await getOwnedQuantities(ids, teile) });
});

/** Trifft ALLE Zeilen des Teil-Farb-Paares: Wer „Kiste 3" einträgt, meint das
 * Teil, nicht eine seiner Set-Zeilen. */
router.put('/parts/:partNumber/:colorId/storage', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/parts/:partNumber/:colorId/storage'>) => {
  const ort = normalisiereLagerort(req.body?.storage);
  const n = await setzeLagerort('part', await writableIds(req.apiUser.user_id),
    [String(req.params.partNumber), String(V.colorId(req.params.colorId))], ort);
  res.json({ success: true, storage: ort, changed: n });
});

router.get('/parts/manual', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/manual'>) => {
  // NUR `search`: Die Liste antwortet ohne Blätterung, ein durchgereichtes
  // page_size deckelte sie unbemerkt.
  res.json({ success: true, parts: await getManualParts(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)),
    req.apiUser.user_id,
    { search: einzelwert(req.query.search), storage: einzelwert(req.query.storage) }) });
});

router.get('/parts/colors', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/colors'>) => {
  res.json({ success:true, colors: await getPartsColors(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
});

router.get('/parts/stats', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/stats'>) => {
  const stats = await getPartsStats(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
  res.json({ success: true, stats });
});


// Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#get-parts-partnumber-colorid-price-history
router.get('/parts/:partNumber/:colorId/price-history', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/price-history'>) => {
  const uid = req.apiUser.user_id;
  const currency = await getSetting(uid, 'currency', 'EUR');
  const data = await getPartPriceHistory(
    await scopeIds(uid, parseScopeMode(req.query.accounts)), einzelwert(req.params.partNumber), V.colorId(req.params.colorId), currency);
  res.json({ success: true, ...data });
});

// Ausführlich: docs/begruendungen/routes/api_v1/parts.ts.md#get-parts-partnumber-colorid-sets
router.get('/parts/:partNumber/:colorId/sets', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/sets'>) => {
  const uids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  const { item, sets } = await verwendendeSets(uids, 'parts', {
    part_number: einzelwert(req.params.partNumber),
    color_id: V.colorId(req.params.colorId),
  });
  res.json({ success: true, item, sets });
});

router.use(fehlerAntwort);

export default router;
