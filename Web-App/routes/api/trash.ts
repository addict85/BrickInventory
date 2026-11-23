/** Visible is what the caller may write: the own account and, as
 * main account, the sub-accounts. */
import { guardFor } from './middleware';
import { confirmWithFactor } from '../../src/account/http/login';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

export function buildTrashRouter(d: Pick<Services, 'account' | 'inventory' | 'collection'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('GET /api/v2/trash', requireToken, async req => {
    return { entries: await d.inventory.listTrash({ writer: req.apiUser.user_id }) };
  });

  router.endpoint('POST /api/v2/trash/:id/restore', requireToken, async req => {
    return { ...(await d.inventory.restore({ writer: req.apiUser.user_id }, req.pathArgs.id)) };
  });

  // Confirmed like /bestand: otherwise a captured token would empty everything piece by piece, irreversibly.
  router.endpoint('DELETE /api/v2/trash/:id', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    await d.inventory.deleteFinal({ writer: req.apiUser.user_id }, req.pathArgs.id);
    return {};
  });

  // With password: a captured app token must not be able to clear away the whole collection.
  router.endpoint('DELETE /api/v2/inventory', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    return { ...(await d.collection.deleteEverythingOwn(req.apiUser.user_id)) };
  });

  router.endpoint('DELETE /api/v2/trash', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    return { removed: await d.inventory.emptyTrash({ writer: req.apiUser.user_id }) };
  });
  return router;
}
