/** Startzustand und Gesundheit: ohne Anmeldung (compose.yaml) und vor den
 * übrigen /api/v1-Routen eingehängt, gefragt wird schon während des Starts. */
import express from 'express';
import { fehlerAntwort } from '../src/http/httpAntwort';
import { versuche, wertOder } from '../src/infra/ergebnis';
import { fehlerText, antwortSprache } from '../src/infra/fehlerTexte';
import { resolveUserId, istVerwalter } from '../src/konto/http/anmeldung';
import { oeffentlicherStartZustand } from '../src/auftraege';
import type { Dienste } from '../src/dienste';

export function baueGesundheitRouter(d: Pick<Dienste, 'auftraege' | 'konto' | 'verwaltung'>) {
  // Wie der Vertrag: eine andere Schreibung ist eine andere Route (404).
  const router = express.Router({ caseSensitive: true });

  router.get('/startup-status', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const angemeldet = !!wertOder(await versuche('startup-status:anmeldung', resolveUserId(d.konto, req)), null);
    res.json(oeffentlicherStartZustand(await d.auftraege.aktuellerStartZustand(), angemeldet));
  });

  // live = Prozess, ready = Datenbank.
  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/health/ready', async (req, res) => {
    if (await d.verwaltung.datenbankBereit()) return void res.json({ status: 'ok' });
    res.status(503).json({
      success: false,
      code: 'datenbank_nicht_erreichbar',
      status: 'unavailable',
      error: fehlerText('datenbank_nicht_erreichbar', antwortSprache(req)),
    });
  });
  // Klemmt die Datenbank, bleibt der Bericht erreichbar — nur ohne Details.
  // Bewusst ohne Schrittschutz: Die Details tragen nichts Geheimes, und eine
  // Überwachung fragt mit einem Token ohne Geräteschlüssel.
  router.get('/health', async (req, res) => {
    const verwalter =
      !!wertOder(await versuche('health:anmeldung', resolveUserId(d.konto, req)), null) && istVerwalter(req);
    res.json(await d.verwaltung.gesundheitsBericht(verwalter));
  });

  router.use(fehlerAntwort);
  return router;
}
