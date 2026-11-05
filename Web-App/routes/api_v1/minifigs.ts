import { fehlerAntwort, pfadParam } from '../../src/infra/httpAntwort';
import { requireToken, kontoSchranke } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget, writableIds } from '../../src/haushalt/haushalt';
import { getManualMinifigs, getMinifigStats, getMinifigs } from '../../src/figuren/abfragen';
import { addManualFig, updateManualFig } from '../../src/figuren/manuelleFiguren';
import { getSetting } from '../../src/einstellungen/settings';
import { getMinifigPriceHistory } from '../../src/finanzen/priceHistory';
import { einzelwert } from '../../src/infra/validate';
import { verwendendeSets } from '../../src/bestand/gemeinsam';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { normalisiereLagerort, setzeLagerort } from '../../src/bestand/lagerort';
import { loescheFigur } from '../../src/sammlung/loeschen';
import { teileDerFigur } from '../../src/figuren/dienst';
import { csvEmpfang } from '../../src/infra/dateiEmpfang';
import { importAlsAuftrag } from '../../src/auftraege/importAlsAuftrag';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Anfrage, Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

router.get('/minifigs', requireToken, async (req: Anfrage<'GET /api/v1/minifigs'>, res: Antwort<'GET /api/v1/minifigs'>) => {
  // Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
  const r = await getMinifigs(await scopeIds(req.apiUser.user_id, parseScopeMode(req.abfrage.accounts)), req.abfrage);
  res.json({ success: true, figs: r.figs, total: r.total });
});

router.post('/minifigs', requireToken, async (req: Anfrage<'POST /api/v1/minifigs'>, res: Antwort<'POST /api/v1/minifigs'>) => {
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const result = await addManualFig(owner, req.eingabe);
  res.json({ success: true, ...result });
});

router.put('/minifigs/:figNumber', requireToken, async (req: Anfrage<'PUT /api/v1/minifigs/:figNumber'>, res: Antwort<'PUT /api/v1/minifigs/:figNumber'>) => {
  // Ohne den Parameter das eigene Konto.
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.abfrage.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  const r = await updateManualFig(besitzer, pfadParam(req, 'figNumber'), req.eingabe);
  res.json({ success: true, ...r });
});

// Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#put-minifigs-fignumber-storage
router.put('/minifigs/:figNumber/storage', requireToken, async (req: Anfrage<'PUT /api/v1/minifigs/:figNumber/storage'>, res: Antwort<'PUT /api/v1/minifigs/:figNumber/storage'>) => {
  const ort = normalisiereLagerort(req.eingabe.storage);
  const n = await setzeLagerort('fig', await writableIds(req.apiUser.user_id),
    [pfadParam(req, 'figNumber')], ort);
  res.json({ success: true, storage: ort, changed: n });
});

router.delete('/minifigs/:figNumber', requireToken, async (req: Anfrage<'DELETE /api/v1/minifigs/:figNumber'>, res: Antwort<'DELETE /api/v1/minifigs/:figNumber'>) => {
  // Ohne den Parameter das eigene Konto.
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.abfrage.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  const geloescht = await loescheFigur(besitzer, String(req.params.figNumber));
  if (geloescht === null) return sendeFehler(req, res, 404, 'minifig_nicht_manuell');
  res.json({ success: true, papierkorb: [geloescht] });
});

router.get('/minifigs/manual', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/manual'>, res: Antwort<'GET /api/v1/minifigs/manual'>) => {
  // Nur `search`, wie bei /parts/manual: page_size deckelte die Liste unbemerkt.
  res.json({ success: true, figs: await getManualMinifigs(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.abfrage.accounts)),
    req.apiUser.user_id,
    { search: req.abfrage.search ?? '' }) });
});

/** Dieselbe Gruppierung wie die Liste, damit Kennzahl und Liste übereinstimmen.
 * Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#get-minifigs-stats */
router.get('/minifigs/stats', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/stats'>, res: Antwort<'GET /api/v1/minifigs/stats'>) => {
  const stats = await getMinifigStats(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.abfrage.accounts)));
  res.json({ success: true, stats });
});

router.get('/minifigs/:figNumber/price-history', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/price-history'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/price-history'>) => {
  const uid = req.apiUser.user_id;
  const currency = await getSetting(uid, 'currency', 'EUR');
  // Blickfeld: Ohne scopeIds() fände sich für eine Figur des Unterkontos keine Erfassung.
  const data = await getMinifigPriceHistory(
    await scopeIds(uid, parseScopeMode(req.abfrage.accounts)), einzelwert(req.params.figNumber), currency);
  res.json({ success: true, ...data });
});

router.get('/minifigs/:figNumber/parts', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/parts'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/parts'>) => {
  res.json({ success: true, ...await teileDerFigur(String(req.params.figNumber)) }); 
});

router.post('/minifigs/import/csv', requireToken, kontoSchranke('upload'), csvEmpfang.single('file'), async (req: Anfrage<'POST /api/v1/minifigs/import/csv'>, res: Antwort<'POST /api/v1/minifigs/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  res.json(await importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'figuren_csv', { text: req.file.buffer.toString('utf-8') }));
});

// Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#get-minifigs-fignumber-sets
router.get('/minifigs/:figNumber/sets', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/sets'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/sets'>) => {
  const uids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.abfrage.accounts));
  const { item, sets } = await verwendendeSets(uids, 'minifigs', {
    fig_number: einzelwert(req.params.figNumber),
  });
  res.json({ success: true, item, sets });
});

router.use(fehlerAntwort);

export default router;
