/** Visible is what the caller may write: the own account and, as
 * main account, the sub-accounts. */
import { guardFor } from './middleware';
import { confirmWithFactor } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

export function buildTrashRouter(d: Pick<Services, 'account' | 'inventory' | 'collection'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/papierkorb', requireToken, async req => {
    return { eintraege: await d.inventory.listTrash({ schreiber: req.apiUser.user_id }) };
  });

  router.endpunkt('POST /api/v1/papierkorb/:id/wiederherstellen', requireToken, async req => {
    return { ...(await d.inventory.placeAgainHer({ schreiber: req.apiUser.user_id }, req.pfad.id)) };
  });

  // Confirmed like /bestand: otherwise a captured token would empty everything piece by piece, irreversibly.
  router.endpunkt('DELETE /api/v1/papierkorb/:id', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    await d.inventory.deleteFinal({ schreiber: req.apiUser.user_id }, req.pfad.id);
    return {};
  });

  // With password: a captured app token must not be able to clear away the whole collection.
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
