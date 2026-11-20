/** Die Seiten der Oberfläche: Bilder unter /images/ und die Links aus E-Mails.
 * Der Rückfall auf die Startseite bleibt als letzte Route in server.ts. */
import express from 'express';
import { sendStartPage, tokenToFragment } from '../src/profile/http/startPage';
import { deliverImage } from '../src/images/http/imageDelivery';
import { guardFor } from './api_v1/middleware';
import type { Dienste } from '../src/services';

export function buildPagesRouter(d: Pick<Dienste, 'account' | 'profile' | 'images'>) {
  const router = express.Router();
  const { requireLoginOrToken, inboundLock } = guardFor(d.account);

  // Wie die übrigen Dateirouten: Wer erst das Passwort wechseln oder den
  // zweiten Faktor einrichten muss, bekommt auch keine Bilder.
  router.get('/images/*pfad', requireLoginOrToken, inboundLock, (req, res) => deliverImage(d, req, res));

  // Erst ein Knopf auf der Seite wirkt (POST), sonst bestätigte schon der
  // Link-Scanner des Mailanbieters eine fremde Adresse.
  router.get(['/verify', '/reset-password', '/uebernahme-abbrechen', '/anmeldung-freigeben'], async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (tokenToFragment(req, res)) return;
    await sendStartPage(d.profile, res);
  });
  return router;
}
