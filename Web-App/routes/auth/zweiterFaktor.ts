/** Der eigene zweite Faktor (src/konto/zweiterFaktor.ts). Einrichten und
 * Abschalten verlangen das Passwort: Wer nur eine offene Sitzung erbeutet,
 * soll das Konto weder aussperren noch den Schutz abbauen. */
import * as K from '../../src/konto/konten';
import { fehlerAntwort } from '../../src/infra/httpAntwort';
import { beendeAndereZugaenge } from '../../src/konto/auth';
import { requireLoginOrToken, angemeldeteNutzerId, bestaetigeCode, bestaetigeMitFaktor, zugangVon, zweiterFaktorPflicht, gnadenfristVerbrauchen } from '../../src/konto/http/anmeldung';
import { bestaetigeEinrichtungGebremst } from '../../src/konto/passwortBestaetigung';
import { hinweisNebenher } from '../../src/konto/kontoHinweis';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import * as zf from '../../src/konto/zweiterFaktor';
import { vertragsRouter } from '../../src/vertrag/pruefen';
import type { Antwort, OffeneAnfrage } from '../../src/vertrag';

const router = vertragsRouter();
const requireLogin = requireLoginOrToken;

router.get('/zweiter-faktor', requireLogin, async (req: OffeneAnfrage<'GET /api/v1/auth/zweiter-faktor'>, res: Antwort<'GET /api/v1/auth/zweiter-faktor'>) => {
  res.json({ success: true, ...(await zf.stand(angemeldeteNutzerId(req))) });
});

router.post('/zweiter-faktor/einrichten', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/einrichten'>, res: Antwort<'POST /api/v1/auth/zweiter-faktor/einrichten'>) => {
  const uid = angemeldeteNutzerId(req);
  // Ohne Passwort nur, wo der Server den Faktor erzwingt (Verwalter direkt nach der
  // Anmeldung); sonst sperrte eine erbeutete Sitzung den Inhaber aus. Die Absage zählt nicht zur Bremse.
  const ohnePasswort = req.eingabe.password === undefined || req.eingabe.password === '';
  if (ohnePasswort) {
    if (!(await zweiterFaktorPflicht(req) && gnadenfristVerbrauchen(req))) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
  } else if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  const geheimnis = await zf.beginneEinrichtung(uid);
  if (!geheimnis) return sendeFehler(req, res, 409, 'zweiter_faktor_schon_aktiv');
  const u = await K.kontoKurz(uid);
  res.json({ success: true, geheimnis, otpauth: zf.otpauthAdresse(geheimnis, u?.username ?? String(uid)) });
});

// Auch mit App-Token (die Android-App richtet so ein): Wer Token und Passwort
// hat, könnte ebenso das Passwort wechseln; eine Sitzungspflicht schützte nichts.
router.post('/zweiter-faktor/bestaetigen', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/bestaetigen'>, res: Antwort<'POST /api/v1/auth/zweiter-faktor/bestaetigen'>) => {
  const uid = angemeldeteNutzerId(req);
  const codes = await bestaetigeEinrichtungGebremst(uid, zugangVon(req), req.eingabe.code);
  if (!Array.isArray(codes)) return sendeFehler(req, res, codes.status, codes.code, codes.vars);
  const kopf = String(req.headers.authorization || '');
  const version = await beendeAndereZugaenge(uid, kopf.startsWith('Bearer ') ? kopf.slice(7) : null,
    req.session?.userId ? req.sessionID : null);
  if (req.session?.userId) req.session.sitzungsVersion = version;
  hinweisNebenher(uid, 'zweiter_faktor_eingerichtet');
  res.json({ success: true, codes });
});

router.post('/zweiter-faktor/abschalten', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/abschalten'>, res: Antwort<'POST /api/v1/auth/zweiter-faktor/abschalten'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await zf.istAktiv(uid)) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
  if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  await zf.schalteAb(uid);
  hinweisNebenher(uid, 'zweiter_faktor_abgeschaltet');
  res.json({ success: true });
});

router.post('/zweiter-faktor/codes', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/auth/zweiter-faktor/codes'>, res: Antwort<'POST /api/v1/auth/zweiter-faktor/codes'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await zf.istAktiv(uid)) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
  if (!await bestaetigeCode(req, res, uid, req.eingabe.code)) return;
  res.json({ success: true, codes: await zf.erneuereCodes(uid) });
});

router.use(fehlerAntwort);

export = router;
