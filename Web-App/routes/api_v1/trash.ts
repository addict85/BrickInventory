/** Visible is what the caller may write: the own account and, as
 * main account, the sub-accounts. */
import { guardFor } from './middleware';
import { confirmWithFactor } from '../../src/account/http/login';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

export function buildTrashRouter(d: Pick<Services, 'account' | 'inventory' | 'collection'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v1');

  router.endpoint('GET /api/v1/papierkorb', requireToken, async req => {
    return { eintraege: await d.inventory.listTrash({ schreiber: req.apiUser.user_id }) };
  });

  router.endpoint('POST /api/v1/papierkorb/:id/wiederherstellen', requireToken, async req => {
    return { ...(await d.inventory.restore({ schreiber: req.apiUser.user_id }, req.pfad.id)) };
  });

  // Confirmed like /bestand: otherwise a captured token would empty everything piece by piece, irreversibly.
  router.endpoint('DELETE /api/v1/papierkorb/:id', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    await d.inventory.deleteFinal({ schreiber: req.apiUser.user_id }, req.pfad.id);
    return {};
  });

  // With password: a captured app token must not be able to clear away the whole collection.
  router.endpoint('DELETE /api/v1/bestand', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ...(await d.collection.deleteEverythingOwn(req.apiUser.user_id)) };
  });

  router.endpoint('DELETE /api/v1/papierkorb', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { entfernt: await d.inventory.emptyTrash({ schreiber: req.apiUser.user_id }) };
  });
  return router;
}
