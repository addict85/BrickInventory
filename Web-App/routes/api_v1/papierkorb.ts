/** Sichtbar ist, was der Aufrufer schreiben darf: das eigene Konto und, als
 * Hauptkonto, die Unterkonten. */
import { guardFor } from './middleware';
import { confirmWithFactor } from '../../src/konto/http/anmeldung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function buildTrashRouter(d: Pick<Dienste, 'konto' | 'bestand' | 'collection'>) {
  const { requireToken } = guardFor(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/papierkorb', requireToken, async req => {
    return { eintraege: await d.bestand.listTrash({ schreiber: req.apiUser.user_id }) };
  });

  router.endpunkt('POST /api/v1/papierkorb/:id/wiederherstellen', requireToken, async req => {
    return { ...(await d.bestand.placeAgainHer({ schreiber: req.apiUser.user_id }, req.pfad.id)) };
  });

  // Bestätigt wie /bestand: Sonst leerte ein erbeutetes Token alles Stück für Stück, unumkehrbar.
  router.endpunkt('DELETE /api/v1/papierkorb/:id', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    await d.bestand.deleteFinal({ schreiber: req.apiUser.user_id }, req.pfad.id);
    return {};
  });

  // Mit Passwort: Ein erbeutetes App-Token soll nicht die ganze Sammlung wegräumen können.
  router.endpunkt('DELETE /api/v1/bestand', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ...(await d.collection.deleteEverythingOwn(req.apiUser.user_id)) };
  });

  router.endpunkt('DELETE /api/v1/papierkorb', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { entfernt: await d.bestand.emptyTrash({ schreiber: req.apiUser.user_id }) };
  });
  return router;
}
