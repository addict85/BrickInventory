/** Öffentlich: Google holt es, bevor Android der App die Passkeys der Domain gibt. */
import express from 'express';
import { assetlinks } from '../src/konto/androidApp';
import { fehlerAntwort } from '../src/infra/httpError';

const router = express.Router();

router.get('/.well-known/assetlinks.json', (_req, res) => {
  const dokument = assetlinks();
  if (!dokument) return res.status(404).type('text/plain').send('Keine App eingetragen (PASSKEY_ANDROID_ZERTIFIKATE).\n');
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(dokument);
});

router.use(fehlerAntwort);

export = router;
