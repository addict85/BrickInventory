/** Öffentlich: Das Wurzelzertifikat ist kein Geheimnis, und ein Gerät braucht
 * es, bevor es dem Server vertraut. Abgleich über den Fingerabdruck. */
import express from 'express';
import { tlsStand } from '../src/infra/tlsWurzel';
import { fehlerAntwort } from '../src/http/httpAntwort';

const router = express.Router();

router.get('/ca.crt', async (_req, res) => {
  const stand = await tlsStand();
  if (!stand) return res.status(404).type('text/plain').send('Keine interne CA eingerichtet (CA_ZERTIFIKAT).\n');
  res.set('Cache-Control', 'no-cache');
  res.set('Content-Disposition', 'attachment; filename="brickinventory-ca.crt"');
  res.type('application/x-x509-ca-cert').send(stand.pem);
});

router.use(fehlerAntwort);

export = router;
