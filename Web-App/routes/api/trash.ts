/** Visible is what the caller may write: the own account and, as
 * main account, the sub-accounts. */
import { guardFor } from './middleware';
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

  // Irreversible, but a login is enough: the client asks "are you sure?" before.
  router.endpoint('DELETE /api/v2/trash/:id', requireToken, async req => {
    await d.inventory.deleteFinal({ writer: req.apiUser.user_id }, req.pathArgs.id);
    return {};
  });

  router.endpoint('DELETE /api/v2/inventory', requireToken, async req => {
    return { ...(await d.collection.deleteEverythingOwn(req.apiUser.user_id)) };
  });

  router.endpoint('DELETE /api/v2/trash', requireToken, async req => {
    return { removed: await d.inventory.emptyTrash({ writer: req.apiUser.user_id }) };
  });
  return router;
}
