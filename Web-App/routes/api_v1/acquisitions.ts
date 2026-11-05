/** Kaufpreis-Erfassungen; die Regeln stehen in src/sammlung/erfassungen.ts. */
import express from 'express';
import { acquisitionTotals as roheSumme } from '../../src/bestand/acquisitions';
import { meldeUndLiefere } from '../../src/infra/fehler';
import { fehlerAntwort } from '../../src/infra/httpAntwort';
import { requireToken, sichtVon } from './middleware';
import { getPartAcquisitions } from '../../src/teile/manuelleTeile';
import { getFigAcquisitions } from '../../src/figuren/manuelleFiguren';
import { erfassungAendern, erfassungLoeschen, setErfassungen } from '../../src/sammlung/erfassungen';
import type { ErfassungsArt } from '../../src/sammlung/erfassungen';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Anfrage, Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

/** Ohne bekannten Preis fehlt der Betrag, statt null zu sein: Geld hat im Vertrag einen Typ. */
function erfassungsSumme(rows: Parameters<typeof roheSumme>[0]) {
  const { amount, ...rest } = roheSumme(rows);
  return amount === null ? rest : { ...rest, amount };
}

type Schluessel = (pfad: Record<string, string | number>) => Array<string | number>;
type Aenderung = Anfrage<'PUT /api/v1/sets/:setNumber/acquisitions/:acqId'>;
type Loeschung = Anfrage<'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId'>;

/** Drei Routen, ein Vertragsschema (Erfassungsaenderung): Der Typ der Set-Route gilt für alle. */
const aendern = (art: ErfassungsArt, schluessel: Schluessel) =>
  async (req: Aenderung, res: express.Response) => {
    res.json(await erfassungAendern(art, req.apiUser.user_id, req.pfad.acqId, schluessel(req.pfad), req.eingabe));
  };

const loeschen = (art: ErfassungsArt, schluessel: Schluessel) =>
  async (req: Loeschung, res: express.Response) => {
    res.json(await erfassungLoeschen(art, req.apiUser.user_id, req.pfad.acqId, schluessel(req.pfad)));
  };

router.get('/sets/:setNumber/acquisitions', requireToken, async (req: Anfrage<'GET /api/v1/sets/:setNumber/acquisitions'>, res: Antwort<'GET /api/v1/sets/:setNumber/acquisitions'>) => {
  const uid = req.apiUser.user_id;
  // Blickfeld: Im Haushalt gehören die Kaufpreise eines Sets oft mehreren Konten.
  // Scheitert das Lesen, zeigt die App eine leere Liste statt einer Fehlerseite.
  const rows = await setErfassungen(sichtVon(req), req.pfad.setNumber)
    .catch(meldeUndLiefere('v1 acquisitions GET', null));
  if (!rows) return res.json({ success: true, acquisitions: [], totals: erfassungsSumme([]) });
  res.json({ success: true, acquisitions: rows, totals: erfassungsSumme(rows), owner_user_id: uid });
});
const setSchluessel: Schluessel = p => [String(p.setNumber)];
router.put('/sets/:setNumber/acquisitions/:acqId', requireToken, aendern('set', setSchluessel));
router.delete('/sets/:setNumber/acquisitions/:acqId', requireToken, loeschen('set', setSchluessel));

router.get('/parts/:partNumber/:colorId/acquisitions', requireToken, async (req: Anfrage<'GET /api/v1/parts/:partNumber/:colorId/acquisitions'>, res: Antwort<'GET /api/v1/parts/:partNumber/:colorId/acquisitions'>) => {
  const rows = await getPartAcquisitions(
    sichtVon(req),
    req.pfad.partNumber, req.pfad.colorId);
  res.json({ success: true, acquisitions: rows, totals: erfassungsSumme(rows), owner_user_id: req.apiUser.user_id });
});
const teilSchluessel: Schluessel = p => [String(p.partNumber), Number(p.colorId)];
router.put('/parts/:partNumber/:colorId/acquisitions/:acqId', requireToken, aendern('part', teilSchluessel));
router.delete('/parts/:partNumber/:colorId/acquisitions/:acqId', requireToken, loeschen('part', teilSchluessel));

router.get('/minifigs/:figNumber/acquisitions', requireToken, async (req: Anfrage<'GET /api/v1/minifigs/:figNumber/acquisitions'>, res: Antwort<'GET /api/v1/minifigs/:figNumber/acquisitions'>) => {
  const rows = await getFigAcquisitions(
    sichtVon(req), req.pfad.figNumber);
  res.json({ success: true, acquisitions: rows, totals: erfassungsSumme(rows), owner_user_id: req.apiUser.user_id });
});
const figurSchluessel: Schluessel = p => [String(p.figNumber)];
router.put('/minifigs/:figNumber/acquisitions/:acqId', requireToken, aendern('fig', figurSchluessel));
router.delete('/minifigs/:figNumber/acquisitions/:acqId', requireToken, loeschen('fig', figurSchluessel));

router.use(fehlerAntwort);

export default router;
