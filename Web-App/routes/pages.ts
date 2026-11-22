/** The pages of the UI: images under /images/ and the links from emails.
 * The fallback to the start page stays the last route in server.ts. */
import express from 'express';
import { sendStartPage, tokenToFragment } from '../src/profile/http/startPage';
import { deliverImage } from '../src/images/http/imageDelivery';
import { guardFor } from './api_v1/middleware';
import type { Services } from '../src/services';

export function buildPagesRouter(d: Pick<Services, 'account' | 'profile' | 'images'>) {
  const router = express.Router();
  const { requireLoginOrToken, inboundLock } = guardFor(d.account);

  // Like the other file routes: whoever first has to change the password or set up
  // the second factor does not get images either.
  router.get('/images/*pfad', requireLoginOrToken, inboundLock, (req, res) => deliverImage(d, req, res));

  // Only a button on the page takes effect (POST), otherwise the mail provider's
  // link scanner would already confirm a foreign address.
  router.get(['/verify', '/reset-password', '/uebernahme-abbrechen', '/anmeldung-freigeben'], async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (tokenToFragment(req, res)) return;
    await sendStartPage(d.profile, res);
  });
  return router;
}
