/** Öffentlich, solange die Einrichtung läuft: Die Anmeldeseite prüft damit,
 * was fehlt, bevor es ein Konto gibt. Antworten sind Schalter und das
 * Wurzelzertifikat — beides steht schon unter /ca.crt. */
import { einrichtungStand } from '../../src/konto/einrichtungStand';
import { istVerwalter } from '../../src/konto/http/anmeldung';
import { vertragsRouter } from '../../src/vertrag/pruefen';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import type { OffeneAnfrage, Antwort } from '../../src/vertrag';

const router = vertragsRouter();

router.get(
  '/einrichtung/stand',
  async (req: OffeneAnfrage<'GET /api/v1/einrichtung/stand'>, res: Antwort<'GET /api/v1/einrichtung/stand'>) => {
    res.set('Cache-Control', 'no-store');
    res.json(await einrichtungStand({ verwalter: istVerwalter(req) }));
  },
);

router.use(fehlerAntwort);

export = router;
