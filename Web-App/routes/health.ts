/** Startup state and health: without login (compose.yaml) and mounted before the
 * other /api/v2 routes; asked already during startup. */
import express from 'express';
import { attempts, valueOr } from '../src/infra/result';
import { errorText, responseLanguage } from '../src/infra/errorTexts';
import { userIdTheRequest, isAdmin } from '../src/account/http/login';
import { publicStartState } from '../src/jobQueue';
import type { Services } from '../src/services';

export function buildGesundheitRouter(d: Pick<Services, 'jobQueue' | 'account' | 'management'>) {
  // Like the contract: a different spelling is a different route (404).
  const router = express.Router({ caseSensitive: true });

  router.get('/startup-status', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const signedIn = !!valueOr(await attempts('startup-status:anmeldung', userIdTheRequest(d.account, req)), null);
    res.json(publicStartState(await d.jobQueue.currentStartState(), signedIn));
  });

  // live = process, ready = database.
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/health/ready', async (req, res) => {
    if (await d.management.databaseReady()) return void res.json({ status: 'ok' });
    res.status(503).json({
      success: false,
      code: 'database_unreachable',
      status: 'unavailable',
      error: errorText('database_unreachable', responseLanguage(req)),
    });
  });
  // If the database is stuck, the report stays reachable — only without details.
  // Deliberately without step guard: the details carry nothing secret, and a
  // monitoring asks with a token without a device key.
  router.get('/health', async (req, res) => {
    const admin = !!valueOr(await attempts('health:anmeldung', userIdTheRequest(d.account, req)), null) && isAdmin(req);
    res.json(await d.management.healthReport(admin));
  });
  return router;
}
