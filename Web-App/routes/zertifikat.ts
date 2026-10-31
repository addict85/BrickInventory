/**
 * GET /ca.crt — das Wurzelzertifikat der internen CA zum Installieren auf
 * Geräten. Öffentlich: Es ist kein Geheimnis, und ein Gerät braucht es, bevor
 * es dem Server vertraut. Abgleichen lässt es sich am Fingerabdruck in den
 * Einstellungen oder auf dem Server (UPGRADE.md, Abschnitt 14).
 */
import express from 'express';
import { tlsStand } from '../src/infra/tlsWurzel';
import { handleRouteError } from '../src/infra/httpError';

const router = express.Router();

router.get('/ca.crt', async (req, res) => {
  try {
    const stand = await tlsStand();
    if (!stand) return res.status(404).type('text/plain').send('Keine interne CA eingerichtet (CA_ZERTIFIKAT).\n');
    res.set('Cache-Control', 'no-cache');
    res.set('Content-Disposition', 'attachment; filename="brickinventory-ca.crt"');
    res.type('application/x-x509-ca-cert').send(stand.pem);
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export = router;
