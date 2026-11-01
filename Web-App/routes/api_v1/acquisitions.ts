/** Kaufpreis-Erfassungen; die Regeln stehen in src/bestand/erfassungen.ts. */
import express from 'express';
import { acquisitionTotals } from '../../src/bestand/acquisitions';
import { fehlerAntwort, pfadParam, meldeUndLiefere } from '../../src/infra/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode } from '../../src/haushalt/haushalt';
import { getPartAcquisitions } from '../../src/teile/manuelleTeile';
import { getFigAcquisitions } from '../../src/figuren/manuelleFiguren';
import { erfassungAendern, erfassungLoeschen, setErfassungen } from '../../src/bestand/erfassungen';
import type { ErfassungsArt } from '../../src/bestand/erfassungen';
import * as V from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

type Schluessel = (req: AuthedRequest) => Array<string | number>;

const aendern = (art: ErfassungsArt, idParam: string, schluessel: Schluessel) =>
  async (req: AuthedRequest, res: express.Response) => {
    res.json(await erfassungAendern(art, req.apiUser.user_id, parseInt(pfadParam(req, idParam)), schluessel(req), req.body || {}));
  };

const loeschen = (art: ErfassungsArt, idParam: string, schluessel: Schluessel) =>
  async (req: AuthedRequest, res: express.Response) => {
    res.json(await erfassungLoeschen(art, req.apiUser.user_id, parseInt(pfadParam(req, idParam)), schluessel(req)));
  };

router.get('/sets/:setNumber/acquisitions', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/sets/:setNumber/acquisitions'>) => {
  const uid = req.apiUser.user_id;
  // Blickfeld: Im Haushalt gehören die Kaufpreise eines Sets oft mehreren Konten.
  // Scheitert das Lesen, zeigt die App eine leere Liste statt einer Fehlerseite.
  const rows = await scopeIds(uid, parseScopeMode(req.query.accounts))
    .then(ids => setErfassungen(ids, pfadParam(req, 'setNumber')))
    .catch(meldeUndLiefere('v1 acquisitions GET', null));
  if (!rows) return res.json({ success: true, acquisitions: [], totals: acquisitionTotals([]) });
  res.json({ success: true, acquisitions: rows, totals: acquisitionTotals(rows), owner_user_id: uid });
});
const setSchluessel: Schluessel = req => [pfadParam(req, 'setNumber')];
router.put('/sets/:setNumber/acquisitions/:acqId', requireToken, aendern('set', 'acqId', setSchluessel));
router.delete('/sets/:setNumber/acquisitions/:acqId', requireToken, loeschen('set', 'acqId', setSchluessel));

router.get('/parts/:partNumber/:colorId/acquisitions', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/acquisitions'>) => {
  const rows = await getPartAcquisitions(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)),
    pfadParam(req, 'partNumber'), pfadParam(req, 'colorId'));
  res.json({ success: true, acquisitions: rows, totals: acquisitionTotals(rows), owner_user_id: req.apiUser.user_id });
});
const teilSchluessel: Schluessel = req => [pfadParam(req, 'partNumber'), V.colorId(req.params.colorId)];
router.put('/parts/:partNumber/:colorId/acquisitions/:acqId', requireToken, aendern('part', 'acqId', teilSchluessel));
router.delete('/parts/:partNumber/:colorId/acquisitions/:acqId', requireToken, loeschen('part', 'acqId', teilSchluessel));

router.get('/minifigs/:figNumber/acquisitions', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/minifigs/:figNumber/acquisitions'>) => {
  const rows = await getFigAcquisitions(
    await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)), pfadParam(req, 'figNumber'));
  res.json({ success: true, acquisitions: rows, totals: acquisitionTotals(rows), owner_user_id: req.apiUser.user_id });
});
const figurSchluessel: Schluessel = req => [pfadParam(req, 'figNumber')];
router.put('/minifigs/:figNumber/acquisitions/:acqId', requireToken, aendern('fig', 'acqId', figurSchluessel));
router.delete('/minifigs/:figNumber/acquisitions/:acqId', requireToken, loeschen('fig', 'acqId', figurSchluessel));

router.use(fehlerAntwort);

export default router;
