/** Sichtbar ist, was der Aufrufer schreiben darf: das eigene Konto und, als
 * Hauptkonto, die Unterkonten. */
import { fehlerAntwort } from '../../src/infra/httpAntwort';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { writableIds } from '../../src/haushalt/haushalt';
import { listePapierkorb, stelleWiederHer, loescheEndgueltig, leerePapierkorb } from '../../src/bestand/papierkorb';
import { requireToken } from './middleware';
import { bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { loescheAllesEigene } from '../../src/sammlung/loeschen';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';

const router = vertragsRouter();

router.get('/papierkorb', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/papierkorb'>) => {
  res.json({ success: true, eintraege: await listePapierkorb(await writableIds(req.apiUser.user_id)) });
});

router.post('/papierkorb/:id/wiederherstellen', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/papierkorb/:id/wiederherstellen'>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  const r = await stelleWiederHer(await writableIds(req.apiUser.user_id), id);
  if (!r.ok) return sendeFehler(req, res, r.code === 'nicht_gefunden' ? 404 : 409, r.code);
  res.json({ success: true, art: r.art, nummer: r.nummer, user_id: r.user_id });
});

// Bestätigt wie /bestand: Sonst leerte ein erbeutetes Token alles Stück für Stück, unumkehrbar.
router.delete('/papierkorb/:id', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/papierkorb/:id'>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  if (!await loescheEndgueltig(await writableIds(req.apiUser.user_id), id))
    return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({ success: true });
});

// Mit Passwort: Ein erbeutetes App-Token soll nicht die ganze Sammlung wegräumen können.
router.delete('/bestand', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/bestand'>) => {
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  res.json({ success: true, ...(await loescheAllesEigene(req.apiUser.user_id)) });
});

router.delete('/papierkorb', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/papierkorb'>) => {
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  res.json({ success: true, entfernt: await leerePapierkorb(await writableIds(req.apiUser.user_id)) });
});

router.use(fehlerAntwort);

export default router;
