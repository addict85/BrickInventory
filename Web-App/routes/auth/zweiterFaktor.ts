/** Der eigene zweite Faktor (src/konto/zweiterFaktor.ts). Einrichten und
 * Abschalten verlangen das Passwort: Wer nur eine offene Sitzung erbeutet,
 * soll das Konto weder aussperren noch den Schutz abbauen. */
import { waechterFuer } from '../api_v1/middleware';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import {
  angemeldeteNutzerId,
  bestaetigeCode,
  bestaetigeMitFaktor,
  zugangVon,
  zweiterFaktorPflicht,
  gnadenfristVerbrauchen,
} from '../../src/konto/http/anmeldung';
import { STATUS_DER_ART } from '../../src/http/fehlerArt';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueZweiterFaktorRouter(d: Pick<Dienste, 'konto'>) {
  const { requireLoginOrToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1/auth');
  const requireLogin = requireLoginOrToken;

  router.endpunkt('GET /api/v1/auth/zweiter-faktor', requireLogin, async req => {
    return { ...(await d.konto.stand(angemeldeteNutzerId(req))) };
  });

  router.endpunkt('POST /api/v1/auth/zweiter-faktor/einrichten', requireLogin, async (req, res) => {
    const uid = angemeldeteNutzerId(req);
    // Ohne Passwort nur, wo der Server den Faktor erzwingt (Verwalter direkt nach der
    // Anmeldung); sonst sperrte eine erbeutete Sitzung den Inhaber aus. Die Absage zählt nicht zur Bremse.
    const ohnePasswort = req.eingabe.password === undefined || req.eingabe.password === '';
    if (ohnePasswort) {
      if (!((await zweiterFaktorPflicht(d.konto, req)) && gnadenfristVerbrauchen(req)))
        return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
    } else if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
    const geheimnis = await d.konto.beginneEinrichtung(uid);
    if (!geheimnis) return sendeFehler(req, res, 409, 'zweiter_faktor_schon_aktiv');
    const u = await d.konto.kontoKurzVon(uid);
    return { geheimnis, otpauth: d.konto.otpauthFuer(geheimnis, u?.username ?? String(uid)) };
  });

  // Auch mit App-Token (die Android-App richtet so ein): Wer Token und Passwort
  // hat, könnte ebenso das Passwort wechseln; eine Sitzungspflicht schützte nichts.
  router.endpunkt('POST /api/v1/auth/zweiter-faktor/bestaetigen', requireLogin, async (req, res) => {
    const uid = angemeldeteNutzerId(req);
    const codes = await d.konto.bestaetigeEinrichtungGebremst(uid, zugangVon(req), req.eingabe.code);
    if (!Array.isArray(codes)) return sendeFehler(req, res, STATUS_DER_ART[codes.art], codes.code, codes.vars);
    const kopf = String(req.headers.authorization || '');
    const version = await d.konto.beendeAndereZugaenge(
      uid,
      kopf.startsWith('Bearer ') ? kopf.slice(7) : null,
      req.session?.userId ? req.sessionID : null,
    );
    if (req.session?.userId) req.session.sitzungsVersion = version;
    d.konto.hinweisNebenher(uid, 'zweiter_faktor_eingerichtet');
    return { codes };
  });

  router.endpunkt('POST /api/v1/auth/zweiter-faktor/abschalten', requireLogin, async (req, res) => {
    const uid = angemeldeteNutzerId(req);
    if (!(await d.konto.istAktiv(uid))) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
    await d.konto.schalteAb(uid);
    d.konto.hinweisNebenher(uid, 'zweiter_faktor_abgeschaltet');
    return {};
  });

  router.endpunkt('POST /api/v1/auth/zweiter-faktor/codes', requireLogin, async (req, res) => {
    const uid = angemeldeteNutzerId(req);
    if (!(await d.konto.istAktiv(uid))) return sendeFehler(req, res, 409, 'zweiter_faktor_nicht_aktiv');
    if (!(await bestaetigeCode(d.konto, req, res, uid, req.eingabe.code))) return;
    return { codes: await d.konto.erneuereCodes(uid) };
  });

  router.use(fehlerAntwort);
  return router;
}
