import { fehlerAntwort, pfadParam } from '../../src/infra/httpError';
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
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

router.get('/minifigs', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs'>) => {
  // Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
  const r = await getMinifigs(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), req.query);
  res.json({ success: true, figs: r.figs, total: r.total });
});

router.post('/minifigs', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/minifigs'>) => {
  const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
  if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
  const result = await addManualFig(owner, req.body);
  res.json({ success: true, ...result });
});

router.put('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/minifigs/:figNumber'>) => {
  // Ohne den Parameter das eigene Konto.
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  const r = await updateManualFig(besitzer, pfadParam(req, 'figNumber'), req.body);
  res.json({ success: true, ...r });
});

// Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#put-minifigs-fignumber-storage
router.put('/minifigs/:figNumber/storage', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/minifigs/:figNumber/storage'>) => {
  const ort = normalisiereLagerort(req.body?.storage);
  const n = await setzeLagerort('fig', await writableIds(req.apiUser.user_id),
    [pfadParam(req, 'figNumber')], ort);
  res.json({ success: true, storage: ort, changed: n });
});

router.delete('/minifigs/:figNumber', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/minifigs/:figNumber'>) => {
  // Ohne den Parameter das eigene Konto.
  const besitzer = await resolveWriteTarget(req.apiUser.user_id, req.query.owner);
  if (besitzer === null) return sendeFehler(req, res, 403, 'kein_zugriff_konto');
  const geloescht = await loescheFigur(besitzer, String(req.params.figNumber));
  if (geloescht === null) return sendeFehler(req, res, 404, 'minifig_nicht_manuell');
  res.json({ success: true, papierkorb: [geloescht] });
});

router.get('/minifigs/manual', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs/manual'>) => {
  // Nur `search`, wie bei /parts/manual: page_size deckelte die Liste unbemerkt.
  res.json({ success: true, figs: await getManualMinifigs(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)),
    req.apiUser.user_id,
    { search: einzelwert(req.query.search) }) });
});

/** Dieselbe Gruppierung wie die Liste, damit Kennzahl und Liste übereinstimmen.
 * Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#get-minifigs-stats */
router.get('/minifigs/stats', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs/stats'>) => {
  const stats = await getMinifigStats(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
  res.json({ success: true, stats });
});

router.get('/minifigs/:figNumber/price-history', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs/:figNumber/price-history'>) => {
  const uid = req.apiUser.user_id;
  const currency = await getSetting(uid, 'currency', 'EUR');
  // Blickfeld: Ohne scopeIds() fände sich für eine Figur des Unterkontos keine Erfassung.
  const data = await getMinifigPriceHistory(
    await scopeIds(uid, parseScopeMode(req.query.accounts)), einzelwert(req.params.figNumber), currency);
  res.json({ success: true, ...data });
});

router.get('/minifigs/:figNumber/parts', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs/:figNumber/parts'>) => {
  res.json({ success: true, ...await teileDerFigur(String(req.params.figNumber)) }); 
});

router.post('/minifigs/import/csv', requireToken, csvEmpfang.single('file'), async (req: AuthedRequest & { file?: { buffer: Buffer } }, res: Antwort<'POST /api/v1/minifigs/import/csv'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  csvImportAntwort(res, await importiereFigurenCsv(req.apiUser.user_id, req.file.buffer.toString('utf-8')));
});

// Ausführlich: docs/begruendungen/routes/api_v1/minifigs.ts.md#get-minifigs-fignumber-sets
router.get('/minifigs/:figNumber/sets', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs/:figNumber/sets'>) => {
  const uids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
  const { item, sets } = await verwendendeSets(uids, 'minifigs', {
    fig_number: einzelwert(req.params.figNumber),
  });
  res.json({ success: true, item, sets });
});

router.use(fehlerAntwort);

export default router;
