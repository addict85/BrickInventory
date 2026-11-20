/** Startzustand und Gesundheit: ohne Anmeldung (compose.yaml) und vor den
 * übrigen /api/v1-Routen eingehängt, gefragt wird schon während des Starts. */
import express from 'express';
import { versuche, valueOr } from '../src/infra/ergebnis';
import { errorText, responseLanguage } from '../src/infra/fehlerTexte';
import { userIdTheRequest, istVerwalter } from '../src/account/http/login';
import { publicStartState } from '../src/auftraege';
import type { Dienste } from '../src/dienste';

export function buildGesundheitRouter(d: Pick<Dienste, 'auftraege' | 'account' | 'management'>) {
  // Wie der Vertrag: eine andere Schreibung ist eine andere Route (404).
  const router = express.Router({ caseSensitive: true });

  router.get('/startup-status', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const angemeldet = !!valueOr(await versuche('startup-status:anmeldung', userIdTheRequest(d.account, req)), null);
    res.json(publicStartState(await d.auftraege.currentStartState(), angemeldet));
  });

  // live = Prozess, ready = Datenbank.
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
  // Klemmt die Datenbank, bleibt der Bericht erreichbar — nur ohne Details.
  // Bewusst ohne Schrittschutz: Die Details tragen nichts Geheimes, und eine
  // Überwachung fragt mit einem Token ohne Geräteschlüssel.
  router.get('/health', async (req, res) => {
    const verwalter =
      !!valueOr(await versuche('health:anmeldung', userIdTheRequest(d.account, req)), null) && istVerwalter(req);
    res.json(await d.management.healthReport(verwalter));
  });
  return router;
}
