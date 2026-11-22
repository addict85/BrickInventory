import { viewOf, guardFor } from './middleware';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';

export function buildMiscRouter(d: Pick<Dienste, 'account' | 'inventory'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/stats', requireToken, async req => {
    return { stats: await d.inventory.inventoryMetrics(viewOf(req)) };
  });

  const OVERVIEW = {
    api: 'Brick Manager API v1',
    version: '1.0',
    auth: 'Bearer token — POST /api/v1/auth/login',
    endpoints: {
      auth: {
        'POST /api/v1/auth/login': 'login',
        'POST /api/v1/auth/logout': 'logout',
        'GET /api/v1/auth/me': 'current user',
        'POST /api/v1/auth/token-create': 'create token',
      },
      sets: {
        'GET /api/v1/sets': 'all sets',
        'POST /api/v1/sets': 'add set',
        'PUT /api/v1/sets/:sn': 'update qty/price/condition',
        'DELETE /api/v1/sets/:sn': 'delete',
        'GET /api/v1/sets/:sn/acquisitions': 'Kaufpreis-Historie',
        'PUT /api/v1/sets/:sn/acquisitions/:id': 'Kaufpreis/Zustand einer Erfassung ändern',
      },
      parts: {
        'GET /api/v1/parts': 'parts list',
        'GET /api/v1/parts/colors': 'colors',
        'GET /api/v1/parts/stats': 'stats',
      },
      finance: { 'GET /api/v1/finance/valuation': 'portfolio value' },
      settings: { 'GET /api/v1/settings': 'user settings', 'PUT /api/v1/settings': 'update settings' },
      stats: { 'GET /api/v1/stats': 'dashboard stats' },
      papierkorb: {
        'GET /api/v1/papierkorb': 'gelöschte Elemente (30 Tage)',
        'POST /api/v1/papierkorb/:id/wiederherstellen': 'zurückholen',
        'DELETE /api/v1/papierkorb/:id': 'endgültig löschen',
        'DELETE /api/v1/papierkorb': 'leeren',
      },
    },
  };

  // Behind requireToken: otherwise the overview would reveal the whole API surface.
  router.endpunkt('GET /api/v1/', requireToken, (_req, res) => res.json(OVERVIEW));
  return router;
}
