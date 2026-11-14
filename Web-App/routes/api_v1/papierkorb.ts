/** Sichtbar ist, was der Aufrufer schreiben darf: das eigene Konto und, als
 * Hauptkonto, die Unterkonten. */
import { waechterFuer } from './middleware';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function bauePapierkorbRouter(d: Pick<Dienste, 'konto' | 'bestand' | 'sammlung'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/papierkorb', requireToken, async req => {
    return { eintraege: await d.bestand.listePapierkorb({ schreiber: req.apiUser.user_id }) };
  });

  router.endpunkt('POST /api/v1/papierkorb/:id/wiederherstellen', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const r = await d.bestand.stelleWiederHer({ schreiber: req.apiUser.user_id }, id);
    if (!r.ok) return sendeFehler(req, res, r.code === 'nicht_gefunden' ? 404 : 409, r.code);
    return { art: r.art, nummer: r.nummer, user_id: r.user_id };
  });

  // Bestätigt wie /bestand: Sonst leerte ein erbeutetes Token alles Stück für Stück, unumkehrbar.
  router.endpunkt('DELETE /api/v1/papierkorb/:id', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    if (!(await d.bestand.loescheEndgueltig({ schreiber: req.apiUser.user_id }, id)))
      return sendeFehler(req, res, 404, 'nicht_gefunden');
    return {};
  });

  // Mit Passwort: Ein erbeutetes App-Token soll nicht die ganze Sammlung wegräumen können.
  router.endpunkt('DELETE /api/v1/bestand', requireToken, async (req, res) => {
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ...(await d.sammlung.loescheAllesEigene(req.apiUser.user_id)) };
  });

  router.endpunkt('DELETE /api/v1/papierkorb', requireToken, async (req, res) => {
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { entfernt: await d.bestand.leerePapierkorb({ schreiber: req.apiUser.user_id }) };
  });

  router.use(fehlerAntwort);
  return router;
}
