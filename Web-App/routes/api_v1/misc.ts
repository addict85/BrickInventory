import { fehlerAntwort } from '../../src/infra/httpAntwort';
import { requireToken, sichtVon } from './middleware';
import { getStats } from '../../src/bestand/kennzahlen';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Anfrage, Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

router.get('/stats', requireToken, async (req: Anfrage<'GET /api/v1/stats'>, res: Antwort<'GET /api/v1/stats'>) => {
  res.json({ success: true, stats: await getStats(sichtVon(req)) });
});

// Hinter requireToken: Die Übersicht verriete sonst die ganze API-Fläche.
router.get('/', requireToken, (_req: AuthedRequest, res: Antwort<'GET /api/v1/'>) => res.json({
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
    papierkorb:{ 'GET /api/v1/papierkorb':'gelöschte Elemente (30 Tage)', 'POST /api/v1/papierkorb/:id/wiederherstellen':'zurückholen',
      'DELETE /api/v1/papierkorb/:id':'endgültig löschen', 'DELETE /api/v1/papierkorb':'leeren' },
  }
}));


router.use(fehlerAntwort);

export default router;
