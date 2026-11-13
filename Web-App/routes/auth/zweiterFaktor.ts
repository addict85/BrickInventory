/** Der eigene zweite Faktor (src/konto/zweiterFaktor.ts). Einrichten und
 * Abschalten verlangen das Passwort: Wer nur eine offene Sitzung erbeutet,
 * soll das Konto weder aussperren noch den Schutz abbauen. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import {
  requireLoginOrToken,
  angemeldeteNutzerId,
  bestaetigeCode,
  bestaetigeMitFaktor,
  zugangVon,
  zweiterFaktorPflicht,
  gnadenfristVerbrauchen,
} from '../../src/konto/http/anmeldung';
import { STATUS_DER_ART } from '../../src/http/fehlerArt';
import { vertragsRouter, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import {
  beendeAndereZugaenge,
  bestaetigeEinrichtungGebremst,
  hinweisNebenher,
  kontoKurzVon,
  stand,
  beginneEinrichtung,
  otpauthAdresse,
  istAktiv,
  schalteAb,
  erneuereCodes,
} from '../../src/konto';

const router = vertragsRouter();
const requireLogin = requireLoginOrToken;

router.get(
  '/zweiter-faktor',
  requireLogin,
  async (req: OffeneAnfrage<'GET /api/v1/auth/zweiter-faktor'>, res: Antwort<'GET /api/v1/auth/zweiter-faktor'>) => {
    res.json({ success: true, ...(await stand(angemeldeteNutzerId(req))) });
  },
);

router.post(
  '/zweiter-faktor/einrichten',
  requireLogin,
  async (
    req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/einrichten'>,
    res: Antwort<'POST /api/v1/auth/zweiter-faktor/einrichten'>,
  ) => {
    const uid = angemeldeteNutzerId(req);
    // Ohne Passwort nur, wo der Server den Faktor erzwingt (Verwalter direkt nach der
    // Anmeldung); sonst sperrte eine erbeutete Sitzung den Inhaber aus. Die Absage zählt nicht zur Bremse.
    const ohnePasswort = req.eingabe.password === undefined || req.eingabe.password === '';
    if (ohnePasswort) {
      if (!((await zweiterFaktorPflicht(req)) && gnadenfristVerbrauchen(req)))
        return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
    } else if (!(await bestaetigeMitFaktor(req, res, uid, req.eingabe.password))) return;
    const geheimnis = await beginneEinrichtung(uid);
    if (!geheimnis) return sendeFehler(req, res, 409, 'zweiter_faktor_schon_aktiv');
    const u = await kontoKurzVon(uid);
    res.json({ success: true, geheimnis, otpauth: otpauthAdresse(geheimnis, u?.username ?? String(uid)) });
  },
);

// Auch mit App-Token (die Android-App richtet so ein): Wer Token und Passwort
// hat, könnte ebenso das Passwort wechseln; eine Sitzungspflicht schützte nichts.
router.post(
  '/zweiter-faktor/bestaetigen',
  requireLogin,
  async (
    req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/bestaetigen'>,
    res: Antwort<'POST /api/v1/auth/zweiter-faktor/bestaetigen'>,
  ) => {
    const uid = angemeldeteNutzerId(req);
    const codes = await bestaetigeEinrichtungGebremst(uid, zugangVon(req), req.eingabe.code);
    if (!Array.isArray(codes)) return sendeFehler(req, res, STATUS_DER_ART[codes.art], codes.code, codes.vars);
    const kopf = String(req.headers.authorization || '');
    const version = await beendeAndereZugaenge(
      uid,
      kopf.startsWith('Bearer ') ? kopf.slice(7) : null,
      req.session?.userId ? req.sessionID : null,
    );
    if (req.session?.userId) req.session.sitzungsVersion = version;
    hinweisNebenher(uid, 'zweiter_faktor_eingerichtet');
    res.json({ success: true, codes });
  },
);

router.post(
  '/zweiter-faktor/abschalten',
  requireLogin,
  async (
    req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/abschalten'>,
    res: Antwort<'POST /api/v1/auth/zweiter-faktor/abschalten'>,
  ) => {
    const uid = angemeldeteNutzerId(req);
    if (!(await istAktiv(uid))) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
    if (!(await bestaetigeMitFaktor(req, res, uid, req.eingabe.password))) return;
    await schalteAb(uid);
    hinweisNebenher(uid, 'zweiter_faktor_abgeschaltet');
    res.json({ success: true });
  },
);

router.post(
  '/zweiter-faktor/codes',
  requireLogin,
  async (
    req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/codes'>,
    res: Antwort<'POST /api/v1/auth/zweiter-faktor/codes'>,
  ) => {
    const uid = angemeldeteNutzerId(req);
    if (!(await istAktiv(uid))) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
    if (!(await bestaetigeCode(req, res, uid, req.eingabe.code))) return;
    res.json({ success: true, codes: await erneuereCodes(uid) });
  },
);

router.use(fehlerAntwort);

export = router;
