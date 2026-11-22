/** Public: Google fetches it before Android gives the app the domain's passkeys. */
import express from 'express';
import { assetlinks } from '../src/factors';
import type { AppConfig } from '../src/infra/config';

export function buildWellKnownRouter(config: Pick<AppConfig, 'androidZertifikate' | 'androidPaket'>) {
  const router = express.Router();

  router.get('/.well-known/assetlinks.json', (_req, res) => {
    const document = assetlinks(config);
    if (!document)
      return res.status(404).type('text/plain').send('Keine App eingetragen (PASSKEY_ANDROID_CERTIFICATES).\n');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(document);
  });
  return router;
}
