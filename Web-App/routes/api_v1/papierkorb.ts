/**
 * /api/v1/papierkorb — gelöschte Sets, manuelle Teile und Figuren der
 * letzten 30 Tage (src/bestand/papierkorb.ts). Sichtbar ist, was der Aufrufer
 * schreiben darf: das eigene Konto und, als Hauptkonto, die Unterkonten.
 */
import express from 'express';
import { fehlerAntwort } from '../../src/infra/httpError';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { writableIds } from '../../src/haushalt/haushalt';
import { listePapierkorb, stelleWiederHer, loescheEndgueltig, leerePapierkorb } from '../../src/bestand/papierkorb';
import { requireToken } from './middleware';
import { loescheAllesEigene } from '../../src/bestand/loeschen';

const router = express.Router();

router.get('/papierkorb', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true, eintraege: await listePapierkorb(await writableIds(req.apiUser.user_id)) });
});

router.post('/papierkorb/:id/wiederherstellen', requireToken, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  const r = await stelleWiederHer(await writableIds(req.apiUser.user_id), id);
  if (!r.ok) return sendeFehler(req, res, r.code === 'nicht_gefunden' ? 404 : 409, r.code);
  res.json({ success: true, art: r.art, nummer: r.nummer, user_id: r.user_id });
});

router.delete('/papierkorb/:id', requireToken, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await loescheEndgueltig(await writableIds(req.apiUser.user_id), id))
    return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({ success: true });
});

// Den ganzen EIGENEN Bestand in den Papierkorb — „Alle meine Daten löschen".
router.delete('/bestand', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true, ...(await loescheAllesEigene(req.apiUser.user_id)) });
});

router.delete('/papierkorb', requireToken, async (req: AuthedRequest, res) => {
  res.json({ success: true, entfernt: await leerePapierkorb(await writableIds(req.apiUser.user_id)) });
});

router.use(fehlerAntwort);

export default router;
