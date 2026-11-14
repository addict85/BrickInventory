/** Die Seiten der Oberfläche: Bilder unter /images/ und die Links aus E-Mails.
 * Der Rückfall auf die Startseite bleibt als letzte Route in server.ts. */
import express from 'express';
import { fehlerAntwort } from '../src/http/httpAntwort';
import { sendeStartseite, tokenInsFragment } from '../src/konto/http/startseite';
import { liefereBild } from '../src/katalog/http/bildAuslieferung';
import { waechterFuer } from './api_v1/middleware';
import type { Dienste } from '../src/dienste';

export function baueSeitenRouter(d: Pick<Dienste, 'konto' | 'katalog'>) {
  const router = express.Router();
  const { requireLoginOrToken, eingangsSperre } = waechterFuer(d.konto);

  // Wie die übrigen Dateirouten: Wer erst das Passwort wechseln oder den
  // zweiten Faktor einrichten muss, bekommt auch keine Bilder.
  router.get('/images/*pfad', requireLoginOrToken, eingangsSperre, (req, res) => liefereBild(d, req, res));

  // Erst ein Knopf auf der Seite wirkt (POST), sonst bestätigte schon der
  // Link-Scanner des Mailanbieters eine fremde Adresse.
  router.get(['/verify', '/reset-password'], async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (tokenInsFragment(req, res)) return;
    await sendeStartseite(d.konto, res);
  });

  router.use(fehlerAntwort);
  return router;
}
