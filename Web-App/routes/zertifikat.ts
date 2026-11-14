/** Nur über HTTPS: Ein Gerät ohne die Wurzel bestätigt die Warnung einmal (HSTS gilt bei einem
 * Zertifikatsfehler nicht), also kein Henne-Ei-Problem und kein Klartextweg zur App. Echt ist die
 * Datei erst nach dem Abgleich des Fingerabdrucks; Name und Kopf sagen es deshalb immer. */
import express from 'express';
import { tlsStand } from '../src/infra/tlsWurzel';

export function baueZertifikatRouter() {
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
