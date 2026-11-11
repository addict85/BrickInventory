/** Die Seiten der Oberfläche: Bilder unter /images/ und die Links aus E-Mails.
 * Der Rückfall auf die Startseite bleibt als letzte Route in server.ts. */
import express from 'express';
import { fehlerAntwort } from '../src/http/httpAntwort';
import { sendeStartseite } from '../src/konto/http/startseite';
import { liefereBild } from '../src/katalog/http/bildAuslieferung';
import { requireLoginOrToken } from '../src/konto/http/anmeldung';
import { eingangsSperre } from './api_v1/middleware';

const router = express.Router();

// Wie die übrigen Dateirouten: Wer erst das Passwort wechseln oder den
// zweiten Faktor einrichten muss, bekommt auch keine Bilder.
router.get('/images/*pfad', requireLoginOrToken, eingangsSperre, liefereBild);

// Erst ein Knopf auf der Seite wirkt (POST), sonst bestätigte schon der
// Link-Scanner des Mailanbieters eine fremde Adresse.
router.get(['/verify', '/reset-password'], async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  await sendeStartseite(res);
});

router.use(fehlerAntwort);

export = router;
