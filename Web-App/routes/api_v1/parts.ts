import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { requireToken, kontoSchranke, sichtVon } from './middleware';
import { getBlColorMap, getManualParts, getOwnedQuantities, getParts, getPartsColors, getPartsStats, getPartsCategories } from '../../src/teile/abfragen';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import { importAlsAuftrag } from '../../src/auftraege/importAlsAuftrag';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import { addManualPart, getPartColorList, updateManualPart } from '../../src/teile/manuelleTeile';
import { getSetting } from '../../src/einstellungen/settings';
import { getPartPriceHistory } from '../../src/finanzen/priceHistory';
import { aendereTeilFarbe } from '../../src/teile/teilFarbeAendern';
import { verwendendeSets } from '../../src/bestand/gemeinsam';
import { normalisiereLagerort } from '../../src/bestand/lagerort';
import { loescheTeil } from '../../src/sammlung/loeschen';
import { seiteAus } from '../../src/infra/seite';
import { Abstriche } from '../../src/infra/ergebnis';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Anfrage, Antwort } from '../../src/http/vertragsRouter';
import { bestandBereich } from '../../src/bestand/prozess';
import { haushaltBereich } from '../../src/haushalt/prozess';
const router = vertragsRouter();

router.get('/parts', requireToken, async (req: Anfrage<'GET /api/v1/parts'>, res: Antwort<'GET /api/v1/parts'>) => {
  const result = await getParts(sichtVon(req), req.abfrage);
  // page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.
  res.json({ success: true, page: req.abfrage.page ?? 1, ...result });
});

router.get('/parts/categories', requireToken, async (req: Anfrage<'GET /api/v1/parts/categories'>, res: Antwort<'GET /api/v1/parts/categories'>) => {
  // Dasselbe Blickfeld wie die Farbliste, sonst filtern zwei Listen derselben
  // Ansicht über verschiedene Konten.
  const uids = sichtVon(req);
  res.json({ success: true, categories: await getPartsCategories(uids) });
});

router.post('/parts/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'), async (req: Anfrage<'POST /api/v1/parts/import/csv'>, res: Antwort<'POST /api/v1/parts/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  res.json(await importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'teile_csv', { text: req.file.buffer.toString('utf-8') }));
});

router.get('/parts/brick-colors', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/parts/brick-colors'>) => {
  const colors = await getPartColorList();
  res.json({ success: true, colors });
});

router.post('/parts', requireToken, async (req: Anfrage<'POST /api/v1/parts'>, res: Antwort<'POST /api/v1/parts'>) => {
  // resolveWriteTarget prüft die RICHTUNG (Hauptkonto → eigenes Unterkonto),
  // nicht bloss die Mitgliedschaft im Blickfeld.
  const owner = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
  const result = await addManualPart(owner, req.eingabe);
  res.json({ success: true, ...result });
});

router.put('/parts/:partNumber/:colorId', requireToken, async (req: Anfrage<'PUT /api/v1/parts/:partNumber/:colorId'>, res: Antwort<'PUT /api/v1/parts/:partNumber/:colorId'>) => {
  // Die Ansicht sagt, wessen Karte gemeint ist; ohne Parameter änderte das
  // Hauptkonto auf der Karte des Kindes die eigene Zeile.
  const besitzer = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
  // Mit Mengenänderung trägt die Antwort die Menge danach (bei quantity_delta
  // weiss der Client sie sonst nicht).
  const r = await updateManualPart(besitzer, req.pfad.partNumber, req.pfad.colorId, req.eingabe);
  res.json({ success: true, ...r });
});

// Eigene Adresse: Die Farbe ist schon Teil der Adresse von PUT /parts/:nr/:farbe.
router.put('/parts/:partNumber/:colorId/color', requireToken, async (req: Anfrage<'PUT /api/v1/parts/:partNumber/:colorId/color'>, res: Antwort<'PUT /api/v1/parts/:partNumber/:colorId/color'>) => {
  const besitzer = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
  // Die neue Farbe muss dastehen: V.colorId() machte aus fehlend „keine Farbe",
  // ein stilles Leeren mit Erfolgsmeldung.
  const roh = req.eingabe.color_id;
  const neueFarbe = Number(roh);
  if (roh === undefined || roh === null || neueFarbe < 0) return sendeFehler(req, res, 400, 'farbe_erforderlich');
  const ergebnis = await aendereTeilFarbe(
    besitzer, req.pfad.partNumber,
    req.pfad.colorId,
    neueFarbe,
    { color_name: req.eingabe.color_name ?? null, color_hex: req.eingabe.color_hex ?? null });
  res.json({ success: true, ...ergebnis });
});

router.delete('/parts/:partNumber/:colorId', requireToken, async (req: Anfrage<'DELETE /api/v1/parts/:partNumber/:colorId'>, res: Antwort<'DELETE /api/v1/parts/:partNumber/:colorId'>) => {
  // Ohne Parameter das eigene Konto — unverändert für Clients, die ihn nicht kennen.
  const besitzer = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
  const geloescht = await loescheTeil(besitzer, req.pfad.partNumber, req.pfad.colorId);
  if (geloescht === null) return sendeFehler(req, res, 404, 'teil_nicht_manuell');
  res.json({ success: true, papierkorb: [geloescht] });
});

router.get('/parts/bl-color-map', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/parts/bl-color-map'>) => {
  const result = await getBlColorMap();
  res.json({ success: true, ...result });
});

/** Je Teil-Farb-Paar `gesamt` (Blickfeld) und `lose` (nicht in einem Set);
 * welche Zahl gilt, entscheidet der Mensch. */
router.post('/parts/owned', requireToken, async (req: Anfrage<'POST /api/v1/parts/owned'>, res: Antwort<'POST /api/v1/parts/owned'>) => {
  const teile = req.eingabe.teile ?? [];
  res.json({ success: true, bestand: await getOwnedQuantities(sichtVon(req), teile) });
});

/** Trifft ALLE Zeilen des Teil-Farb-Paares: Wer „Kiste 3" einträgt, meint das
 * Teil, nicht eine seiner Set-Zeilen. */
router.put('/parts/:partNumber/:colorId/storage', requireToken, async (req: Anfrage<'PUT /api/v1/parts/:partNumber/:colorId/storage'>, res: Antwort<'PUT /api/v1/parts/:partNumber/:colorId/storage'>) => {
  const ort = normalisiereLagerort(req.eingabe.storage);
  const n = await bestandBereich().lagerortDienst.setzeLagerort('part', { schreiber: req.apiUser.user_id },
    [req.pfad.partNumber, String(req.pfad.colorId)], ort);
  res.json({ success: true, storage: ort, changed: n });
});

router.get('/parts/manual', requireToken, async (req: Anfrage<'GET /api/v1/parts/manual'>, res: Antwort<'GET /api/v1/parts/manual'>) => {
  const ab = new Abstriche();
  const alle = await getManualParts(sichtVon(req), req.apiUser.user_id,
    { search: req.abfrage.search ?? '', storage: req.abfrage.storage ?? '' }, ab);
  const { eintraege: parts, ...seite } = seiteAus(alle, req.abfrage);
  res.json({ success: true, parts, ...seite, ...ab.angabe() });
});

router.get('/parts/colors', requireToken, async (req: Anfrage<'GET /api/v1/parts/colors'>, res: Antwort<'GET /api/v1/parts/colors'>) => {
  res.json({ success:true, colors: await getPartsColors(sichtVon(req)) });
});

router.get('/parts/stats', requireToken, async (req: Anfrage<'GET /api/v1/parts/stats'>, res: Antwort<'GET /api/v1/parts/stats'>) => {
  const stats = await getPartsStats(sichtVon(req));
  res.json({ success: true, stats });
});


// Dieselbe Umsetzung wie für die Webapp; steht unten, damit feste Pfade vorher greifen.
router.get('/parts/:partNumber/:colorId/price-history', requireToken, async (req: Anfrage<'GET /api/v1/parts/:partNumber/:colorId/price-history'>, res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/price-history'>) => {
  const uid = req.apiUser.user_id;
  const currency = await getSetting(uid, 'currency', 'EUR');
  const data = await getPartPriceHistory(
    sichtVon(req), req.pfad.partNumber, req.pfad.colorId, currency);
  res.json({ success: true, ...data });
});

// Im Blickfeld, damit die Liste zur Teileliste passt, aus der man kommt.
router.get('/parts/:partNumber/:colorId/sets', requireToken, async (req: Anfrage<'GET /api/v1/parts/:partNumber/:colorId/sets'>, res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/sets'>) => {
  const uids = sichtVon(req);
  const { item, sets } = await verwendendeSets(uids, 'parts', {
    part_number: req.pfad.partNumber,
    color_id: req.pfad.colorId,
  });
  res.json({ success: true, item, sets });
});

router.use(fehlerAntwort);

export default router;
