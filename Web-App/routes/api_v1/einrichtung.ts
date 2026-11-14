/** Öffentlich, solange die Einrichtung läuft: Die Anmeldeseite prüft damit,
 * was fehlt, bevor es ein Konto gibt. Antworten sind Schalter und das
 * Wurzelzertifikat — beides steht schon unter /ca.crt. */
import { istVerwalter, ipThrottle } from '../../src/konto/http/anmeldung';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueEinrichtungRouter(d: Pick<Dienste, 'konto'>) {
  const router = vertragsRouter('/api/v1');

  router.endpunkt(
    'GET /api/v1/einrichtung/stand',
    ipThrottle(d.konto, 'einrichtung-stand', 120, 10 * 60 * 1000),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      return { ...(await d.konto.einrichtungStand({ verwalter: istVerwalter(req) })) };
    },
  );

  router.use(fehlerAntwort);
  return router;
}
