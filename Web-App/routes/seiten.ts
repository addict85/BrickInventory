/** Die Seiten der Oberfläche: Bilder unter /images/ und die Links aus E-Mails.
 * Der Rückfall auf die Startseite bleibt als letzte Route in server.ts. */
import express from 'express';
import { fehlerAntwort } from '../src/http/httpAntwort';
import { sendeStartseite } from '../src/konto/indexHtml';
import { liefereBild } from '../src/katalog/http/bildAuslieferung';

const router = express.Router();

router.get('/images/*pfad', liefereBild);

// Erst ein Knopf auf der Seite wirkt (POST), sonst bestätigte schon der
// Link-Scanner des Mailanbieters eine fremde Adresse.
router.get(['/verify', '/reset-password'], async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  await sendeStartseite(res);
});

router.use(fehlerAntwort);

export = router;
