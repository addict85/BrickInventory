/** Startzustand und Gesundheit: ohne Anmeldung (compose.yaml) und vor den
 * übrigen /api/v1-Routen eingehängt, gefragt wird schon während des Starts. */
import express from 'express';
import { fehlerAntwort } from '../src/infra/httpAntwort';
import { logAndContinue } from '../src/infra/fehler';
import { fehlerText, antwortSprache } from '../src/infra/fehlerTexte';
import { resolveUserId, istVerwalter } from '../src/konto/http/anmeldung';
import { aktuellerStartZustand, oeffentlicherStartZustand } from '../src/auftraege/startZustand';
import { gesundheitsBericht, datenbankBereit } from '../src/verwaltung/gesundheit';

// Wie der Vertrag: eine andere Schreibung ist eine andere Route (404).
const router = express.Router({ caseSensitive: true });

router.get('/startup-status', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const angemeldet = !!(await resolveUserId(req).catch(logAndContinue('startup-status:anmeldung')));
  res.json(oeffentlicherStartZustand(await aktuellerStartZustand(), angemeldet));
});

// live = Prozess, ready = Datenbank.
router.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});
router.get('/health/ready', async (req, res) => {
  if (await datenbankBereit()) return void res.json({ status: 'ok' });
  res.status(503).json({
    success: false,
    code: 'datenbank_nicht_erreichbar',
    status: 'unavailable',
    error: fehlerText('datenbank_nicht_erreichbar', antwortSprache(req)),
  });
});
// Klemmt die Datenbank, bleibt der Bericht erreichbar — nur ohne Details.
router.get('/health', async (req, res) => {
  const verwalter = !!(await resolveUserId(req).catch(logAndContinue('health:anmeldung'))) && istVerwalter(req);
  res.json(await gesundheitsBericht(verwalter));
});

router.use(fehlerAntwort);

export = router;
