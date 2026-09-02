/** /api/v1 — Dashboard-Statistiken und Endpoint-Übersicht. */
import express from 'express';
import { handleRouteError } from '../../utils/httpError';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode } from '../../utils/household';
import { getStats } from '../../utils/handlers/stats';
const router = express.Router();

router.get('/stats', requireToken, async (req: AuthedRequest, res) => {
  try {
    // Gemeinsamer Handler (auch /api/settings/stats): zählt jetzt auch die
    // eigenen (hochgeladenen) Anleitungen mit und filtert Sets nicht mehr
    // auf pieces IS NOT NULL — Parität zur Webapp.
    res.json({ success: true, stats: await getStats(await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts))) });
  } catch (e) { handleRouteError(res, e); }
});

// Hinter requireToken: die Übersicht verrät ohne Auth die komplette API-Fläche.
router.get('/', requireToken, (_req: AuthedRequest, res) => res.json({
  api:'Brick Manager API v1', version:'1.0',
  auth:'Bearer token — POST /api/v1/auth/login',
  endpoints:{
    auth:{ 'POST /api/v1/auth/login':'login', 'POST /api/v1/auth/logout':'logout', 'GET /api/v1/auth/me':'current user', 'POST /api/v1/auth/token-create':'create token' },
    sets:{ 'GET /api/v1/sets':'all sets', 'POST /api/v1/sets':'add set', 'PUT /api/v1/sets/:sn':'update qty/price/condition', 'DELETE /api/v1/sets/:sn':'delete',
      'GET /api/v1/sets/:sn/acquisitions':'Kaufpreis-Historie', 'PUT /api/v1/sets/:sn/acquisitions/:id':'Kaufpreis/Zustand einer Erfassung ändern' },
    parts:{ 'GET /api/v1/parts':'parts list', 'GET /api/v1/parts/colors':'colors', 'GET /api/v1/parts/stats':'stats' },
    finance:{ 'GET /api/v1/finance/valuation':'portfolio value' },
    settings:{ 'GET /api/v1/settings':'user settings', 'PUT /api/v1/settings':'update settings' },
    stats:{ 'GET /api/v1/stats':'dashboard stats' },
  }
}));


export default router;
