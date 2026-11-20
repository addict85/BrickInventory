/** Only via HTTPS: a device without the root confirms the warning once (HSTS does not apply on a
 * certificate error), so no chicken-and-egg problem and no plaintext path to the app. The file is only
 * genuine after comparing the fingerprint; name and header therefore always say so. */
import express from 'express';
import { tlsStand } from '../src/infra/tlsWurzel';

export function buildCertificateRouter() {
  const router = express.Router();

  router.get('/ca.crt', async (req, res) => {
    if (!req.secure)
      return res
        .status(403)
        .type('text/plain')
        .send('Das Wurzelzertifikat gibt es nur über HTTPS (https://<Server>/ca.crt).\n');
    const stand = await tlsStand();
    if (!stand) return res.status(404).type('text/plain').send('Keine interne CA eingerichtet (CA_ZERTIFIKAT).\n');
    res.set('Cache-Control', 'no-cache');
    res.set('Content-Disposition', 'attachment; filename="brickinventory-ca-fingerabdruck-pruefen.crt"');
    res.set(
      'X-Fingerabdruck-Pruefen',
      'SHA-256 vor dem Installieren mit der angemeldeten Web-Oberflaeche ' +
        '(Einstellungen > Server-Zertifikat) oder dem Protokoll von Caddy vergleichen',
    );
    res.type('application/x-x509-ca-cert').send(stand.pem);
  });
  return router;
}
