/** Public while the setup runs: the login page uses it to check
 * what is missing before there is an account. The answers are switches and the
 * root certificate — both are already available under /ca.crt. */
import { istVerwalter, ipThrottle } from '../../src/account/http/login';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';

export function buildSetupRouter(d: Pick<Dienste, 'account' | 'profile'>) {
  const router = vertragsRouter('/api/v1');

  router.endpunkt(
    'GET /api/v1/einrichtung/stand',
    ipThrottle(d.account, 'einrichtung-stand', 120, 10 * 60 * 1000),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      return { ...(await d.profile.setupStatus({ isAdmin: istVerwalter(req) })) };
    },
  );
  return router;
}
