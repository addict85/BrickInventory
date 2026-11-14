/** Öffentlich: Google holt es, bevor Android der App die Passkeys der Domain gibt. */
import express from 'express';
import { assetlinks } from '../src/konto';
import { fehlerAntwort } from '../src/http/httpAntwort';
import type { Konfig } from '../src/infra/konfig';

export function baueWellKnownRouter(konfig: Pick<Konfig, 'androidZertifikate' | 'androidPaket'>) {
  const router = express.Router();

  router.get('/.well-known/assetlinks.json', (_req, res) => {
    const dokument = assetlinks(konfig);
    if (!dokument)
      return res.status(404).type('text/plain').send('Keine App eingetragen (PASSKEY_ANDROID_ZERTIFIKATE).\n');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(dokument);
  });

  router.use(fehlerAntwort);
  return router;
}
