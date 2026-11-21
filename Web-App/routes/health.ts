/** Startup state and health: without login (compose.yaml) and mounted before the
 * other /api/v1 routes; asked already during startup. */
import express from 'express';
import { versuche, valueOr } from '../src/infra/result';
import { errorText, responseLanguage } from '../src/infra/errorTexts';
import { userIdTheRequest, istVerwalter } from '../src/account/http/login';
import { publicStartState } from '../src/jobQueue';
import type { Dienste } from '../src/services';

export function buildGesundheitRouter(d: Pick<Dienste, 'jobQueue' | 'account' | 'management'>) {
  // Like the contract: a different spelling is a different route (404).
  const router = express.Router({ caseSensitive: true });

  router.get('/startup-status', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const angemeldet = !!valueOr(await versuche('startup-status:anmeldung', userIdTheRequest(d.account, req)), null);
    res.json(publicStartState(await d.jobQueue.currentStartState(), angemeldet));
  });

  // live = process, ready = database.
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/health/ready', async (req, res) => {
    if (await d.management.databaseReady()) return void res.json({ status: 'ok' });
    res.status(503).json({
      success: false,
      code: 'datenbank_nicht_erreichbar',
      status: 'unavailable',
      error: errorText('datenbank_nicht_erreichbar', responseLanguage(req)),
    });
  });
  // If the database is stuck, the report stays reachable — only without details.
  // Deliberately without step guard: the details carry nothing secret, and a
  // monitoring asks with a token without a device key.
  router.get('/health', async (req, res) => {
    const verwalter =
      !!valueOr(await versuche('health:anmeldung', userIdTheRequest(d.account, req)), null) && istVerwalter(req);
    res.json(await d.management.healthReport(verwalter));
  });
  return router;
}
