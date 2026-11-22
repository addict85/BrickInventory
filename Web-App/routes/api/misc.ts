import { viewOf, guardFor } from './middleware';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

export function buildMiscRouter(d: Pick<Services, 'account' | 'inventory'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('GET /api/v2/stats', requireToken, async req => {
    return { stats: await d.inventory.inventoryMetrics(viewOf(req)) };
  });

  const OVERVIEW = {
    api: 'Brick Manager API v1',
    version: '1.0',
    auth: 'Bearer token — POST /api/v2/auth/login',
    endpoints: {
      auth: {
        'POST /api/v2/auth/login': 'login',
        'POST /api/v2/auth/logout': 'logout',
        'GET /api/v2/auth/me': 'current user',
        'POST /api/v2/auth/token-create': 'create token',
      },
      sets: {
        'GET /api/v2/sets': 'all sets',
        'POST /api/v2/sets': 'add set',
        'PUT /api/v2/sets/:sn': 'update qty/price/condition',
        'DELETE /api/v2/sets/:sn': 'delete',
        'GET /api/v2/sets/:sn/acquisitions': 'Kaufpreis-Historie',
        'PUT /api/v2/sets/:sn/acquisitions/:id': 'Kaufpreis/Zustand einer Erfassung ändern',
      },
      parts: {
        'GET /api/v2/parts': 'parts list',
        'GET /api/v2/parts/colors': 'colors',
        'GET /api/v2/parts/stats': 'stats',
      },
      finance: { 'GET /api/v2/finance/valuation': 'portfolio value' },
      settings: { 'GET /api/v2/settings': 'user settings', 'PUT /api/v2/settings': 'update settings' },
      stats: { 'GET /api/v2/stats': 'dashboard stats' },
      trash: {
        'GET /api/v2/trash': 'gelöschte Elemente (30 Tage)',
        'POST /api/v2/trash/:id/restore': 'zurückholen',
        'DELETE /api/v2/trash/:id': 'endgültig löschen',
        'DELETE /api/v2/trash': 'leeren',
      },
    },
  };

  // Behind requireToken: otherwise the overview would reveal the whole API surface.
  router.endpoint('GET /api/v2/', requireToken, (_req, res) => res.json(OVERVIEW));
  return router;
}
