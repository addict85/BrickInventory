/** Öffentlich, solange die Einrichtung läuft: Die Anmeldeseite prüft damit,
 * was fehlt, bevor es ein Konto gibt. Antworten sind Schalter und das
 * Wurzelzertifikat — beides steht schon unter /ca.crt. */
import { einrichtungStand } from '../../src/konto';
import { istVerwalter, ipThrottle } from '../../src/konto/http/anmeldung';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import { vertragsRouter, type OffeneAnfrage, type Antwort } from '../../src/http/vertragsRouter';

const router = vertragsRouter();

router.get(
  '/einrichtung/stand',
  ipThrottle('einrichtung-stand', 120, 10 * 60 * 1000),
  async (req: OffeneAnfrage<'GET /api/v1/einrichtung/stand'>, res: Antwort<'GET /api/v1/einrichtung/stand'>) => {
    res.set('Cache-Control', 'no-store');
    res.json(await einrichtungStand({ verwalter: istVerwalter(req) }));
  },
);

router.use(fehlerAntwort);

export = router;
