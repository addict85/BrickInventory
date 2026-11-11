import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { requireToken, kontoSchranke, sichtVon } from './middleware';
import { getManualMinifigs, getMinifigStats, getMinifigs } from '../../src/figuren/abfragen';
import { addManualFig, updateManualFig } from '../../src/figuren/manuelleFiguren';
import { getSetting } from '../../src/einstellungen/settings';
import { getMinifigPriceHistory } from '../../src/finanzen/priceHistory';
import { verwendendeSets } from '../../src/bestand/gemeinsam';
import { normalisiereLagerort } from '../../src/bestand/lagerort';
import { loescheFigur } from '../../src/sammlung/loeschen';
import { teileDerFigur } from '../../src/figuren/dienst';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import { importAlsAuftrag } from '../../src/auftraege/importAlsAuftrag';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import { seiteAus } from '../../src/infra/seite';
import { Abstriche } from '../../src/infra/ergebnis';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Anfrage, Antwort } from '../../src/http/vertragsRouter';
import { bestandBereich } from '../../src/bestand/prozess';
import { haushaltBereich } from '../../src/haushalt/prozess';
const router = vertragsRouter();

router.get('/minifigs', requireToken, async (req: Anfrage<'GET /api/v1/minifigs'>, res: Antwort<'GET /api/v1/minifigs'>) => {
  // Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
  const r = await getMinifigs(sichtVon(req), req.abfrage);
  res.json({ success: true, figs: r.figs, total: r.total });
});

router.post('/minifigs', requireToken, async (req: Anfrage<'POST /api/v1/minifigs'>, res: Antwort<'POST /api/v1/minifigs'>) => {
  const owner = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
  const result = await addManualFig(owner, req.eingabe);
  res.json({ success: true, ...result });
});

router.put('/minifigs/:figNumber', requireToken, async (req: Anfrage<'PUT /api/v1/minifigs/:figNumber'>, res: Antwort<'PUT /api/v1/minifigs/:figNumber'>) => {
  // Ohne den Parameter das eigene Konto.
  const besitzer = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
  const r = await updateManualFig(besitzer, req.pfad.figNumber, req.eingabe);
  res.json({ success: true, ...r });
});

// Trifft alle Zeilen der Figur im Schreibbereich: Gemeint ist die Figur, nicht eine Zeile.
router.put('/minifigs/:figNumber/storage', requireToken, async (req: Anfrage<'PUT /api/v1/minifigs/:figNumber/storage'>, res: Antwort<'PUT /api/v1/minifigs/:figNumber/storage'>) => {
  const ort = normalisiereLagerort(req.eingabe.storage);
  const n = await bestandBereich().lagerortDienst.setzeLagerort('fig', { schreiber: req.apiUser.user_id },
    [req.pfad.figNumber], ort);
  res.json({ success: true, storage: ort, changed: n });
});

router.delete('/minifigs/:figNumber', requireToken, async (req: Anfrage<'DELETE /api/v1/minifigs/:figNumber'>, res: Antwort<'DELETE /api/v1/minifigs/:figNumber'>) => {
  // Ohne den Parameter das eigene Konto.
  const besitzer = await haushaltBereich().haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
  const geloescht = await loescheFigur(besitzer, req.pfad.figNumber);
  if (geloescht === null) return sendeFehler(req, res, 404, 'minifig_nicht_manuell');
  res.json({ success: true, papierkorb: [geloescht] });
});

router.get('/minifigs/manual', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/manual'>, res: Antwort<'GET /api/v1/minifigs/manual'>) => {
  const ab = new Abstriche();
  const alle = await getManualMinifigs(sichtVon(req), req.apiUser.user_id, { search: req.abfrage.search ?? '' }, ab);
  const { eintraege: figs, ...seite } = seiteAus(alle, req.abfrage);
  res.json({ success: true, figs, ...seite, ...ab.angabe() });
});

/** Dieselbe Gruppierung wie die Liste, damit Kennzahl und Liste übereinstimmen. */
router.get('/minifigs/stats', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/stats'>, res: Antwort<'GET /api/v1/minifigs/stats'>) => {
  const stats = await getMinifigStats(
    sichtVon(req));
  res.json({ success: true, stats });
});

router.get('/minifigs/:figNumber/price-history', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/price-history'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/price-history'>) => {
  const uid = req.apiUser.user_id;
  const currency = await getSetting(uid, 'currency', 'EUR');
  // Blickfeld: Ohne scopeIds() fände sich für eine Figur des Unterkontos keine Erfassung.
  const data = await getMinifigPriceHistory(
    sichtVon(req), req.pfad.figNumber, currency);
  res.json({ success: true, ...data });
});

router.get('/minifigs/:figNumber/parts', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/parts'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/parts'>) => {
  res.json({ success: true, ...await teileDerFigur(req.pfad.figNumber) }); 
});

router.post('/minifigs/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'), async (req: Anfrage<'POST /api/v1/minifigs/import/csv'>, res: Antwort<'POST /api/v1/minifigs/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  res.json(await importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'figuren_csv', { text: req.file.buffer.toString('utf-8') }));
});

// Dieselbe Abfrage wie bei Teilen (src/bestand/gemeinsam.ts), im Blickfeld des Haushalts.
router.get('/minifigs/:figNumber/sets', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/sets'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/sets'>) => {
  const uids = sichtVon(req);
  const { item, sets } = await verwendendeSets(uids, 'minifigs', {
    fig_number: req.pfad.figNumber,
  });
  res.json({ success: true, item, sets });
});

router.use(fehlerAntwort);

export default router;
