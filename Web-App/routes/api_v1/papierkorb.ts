/**
 * /api/v1/papierkorb — gelöschte Sets, manuelle Teile und Figuren der
 * letzten 30 Tage (utils/papierkorb.ts). Sichtbar ist, was der Aufrufer
 * schreiben darf: das eigene Konto und, als Hauptkonto, die Unterkonten.
 */
import express from 'express';
import { handleRouteError } from '../../src/infra/httpError';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { writableIds } from '../../utils/household';
import { listePapierkorb, stelleWiederHer, loescheEndgueltig, leerePapierkorb } from '../../utils/papierkorb';
import { requireToken } from './middleware';
import { loescheAllesEigene } from '../../utils/loeschen';

const router = express.Router();

router.get('/papierkorb', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, eintraege: await listePapierkorb(await writableIds(req.apiUser.user_id)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/papierkorb/:id/wiederherstellen', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const r = await stelleWiederHer(await writableIds(req.apiUser.user_id), id);
    if (!r.ok) return sendeFehler(req, res, r.code === 'nicht_gefunden' ? 404 : 409, r.code);
    res.json({ success: true, art: r.art, nummer: r.nummer, user_id: r.user_id });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.delete('/papierkorb/:id', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (!await loescheEndgueltig(await writableIds(req.apiUser.user_id), id))
      return sendeFehler(req, res, 404, 'nicht_gefunden');
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Den ganzen EIGENEN Bestand in den Papierkorb — „Alle meine Daten löschen".
router.delete('/bestand', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, ...(await loescheAllesEigene(req.apiUser.user_id)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.delete('/papierkorb', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, entfernt: await leerePapierkorb(await writableIds(req.apiUser.user_id)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
