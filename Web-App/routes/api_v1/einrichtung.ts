/** Öffentlich, solange die Einrichtung läuft: Die Anmeldeseite prüft damit,
 * was fehlt, bevor es ein Konto gibt. Antworten sind Schalter und das
 * Wurzelzertifikat — beides steht schon unter /ca.crt. */
import { istVerwalter, ipThrottle } from '../../src/konto/http/anmeldung';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import { vertragsRouter, type OffeneAnfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

export function baueEinrichtungRouter(d: Dienste) {
  const router = vertragsRouter();

  router.get(
    '/einrichtung/stand',
    ipThrottle(d.konto, 'einrichtung-stand', 120, 10 * 60 * 1000),
    async (req: OffeneAnfrage<'GET /api/v1/einrichtung/stand'>, res: Antwort<'GET /api/v1/einrichtung/stand'>) => {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, ...(await d.konto.einrichtungStand({ verwalter: istVerwalter(req) })) });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
