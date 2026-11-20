/** Sichtbar ist, was der Aufrufer schreiben darf: das eigene Konto und, als
 * Hauptkonto, die Unterkonten. */
import { guardFor } from './middleware';
import { confirmWithFactor } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function buildTrashRouter(d: Pick<Dienste, 'account' | 'inventory' | 'collection'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/papierkorb', requireToken, async req => {
    return { eintraege: await d.inventory.listTrash({ schreiber: req.apiUser.user_id }) };
  });

  router.endpunkt('POST /api/v1/papierkorb/:id/wiederherstellen', requireToken, async req => {
    return { ...(await d.inventory.placeAgainHer({ schreiber: req.apiUser.user_id }, req.pfad.id)) };
  });

  // Bestätigt wie /bestand: Sonst leerte ein erbeutetes Token alles Stück für Stück, unumkehrbar.
  router.endpunkt('DELETE /api/v1/papierkorb/:id', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    await d.inventory.deleteFinal({ schreiber: req.apiUser.user_id }, req.pfad.id);
    return {};
  });

  // Mit Passwort: Ein erbeutetes App-Token soll nicht die ganze Sammlung wegräumen können.
  router.endpunkt('DELETE /api/v1/bestand', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ...(await d.collection.deleteEverythingOwn(req.apiUser.user_id)) };
  });

  router.endpunkt('DELETE /api/v1/papierkorb', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { entfernt: await d.inventory.emptyTrash({ schreiber: req.apiUser.user_id }) };
  });
  return router;
}
