/** Öffentlich: Das Wurzelzertifikat ist kein Geheimnis, und ein Gerät braucht
 * es, bevor es dem Server vertraut. Abgleich über den Fingerabdruck. */
import express from 'express';
import { tlsStand } from '../src/infra/tlsWurzel';
import { fehlerAntwort } from '../src/http/httpAntwort';

const router = express.Router();

router.get('/ca.crt', async (req, res) => {
  const stand = await tlsStand();
  if (!stand) return res.status(404).type('text/plain').send('Keine interne CA eingerichtet (CA_ZERTIFIKAT).\n');
  res.set('Cache-Control', 'no-cache');
  // Über HTTP kann die Datei unterwegs getauscht sein: Name und Kopf sagen es, den echten
  // Wert nennen nur die angemeldete Oberfläche und das Protokoll des Servers.
  const name = req.secure ? 'brickinventory-ca.crt' : 'brickinventory-ca-fingerabdruck-pruefen.crt';
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  if (!req.secure)
    res.set(
      'X-Fingerabdruck-Pruefen',
      'SHA-256 vor dem Installieren mit der angemeldeten Web-Oberflaeche ' +
        '(Einstellungen > Server-Zertifikat) oder dem Protokoll von Caddy vergleichen',
    );
  res.type('application/x-x509-ca-cert').send(stand.pem);
});

router.use(fehlerAntwort);

export = router;
