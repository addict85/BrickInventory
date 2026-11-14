/** Anmeldung, Token und Profil unter /api/v1/auth; die Teilrouter aus routes/auth/ hängen dahinter. */
import { waechterFuer } from './api_v1/middleware';
import { sitzungsKeksName, sitzungsKeksOptionen } from '../src/http/sitzungsKeks';
import { meldeFehler } from '../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../src/http/httpAntwort';
import {
  anmelden,
  establishSession,
  nutzerId,
  angemeldeteNutzerId,
  ipThrottle,
  bestaetigeMitFaktor,
  zweiterFaktorPflicht,
} from '../src/konto/http/anmeldung';
import type { Request, Response } from 'express';
import { meldeZugangsAenderung } from '../src/konto/http/zugangsWache';
import { fehlerText, antwortSprache } from '../src/infra/fehlerTexte';
import { baueBenutzerRouter } from './auth/benutzer';
import { baueZweiterFaktorRouter } from './auth/zweiterFaktor';
import { baueRegistrierungRouter } from './auth/registrierung';
import { baueQrRouter } from './auth/qr';
import { bauePasskeyRouter } from './auth/passkey';
import { STATUS_DER_ART } from '../src/http/fehlerArt';
import { vertragsRouter, type Antwort, type OffeneAnfrage } from '../src/http/vertragsRouter';
import {
  assertLoginAllowed,
  USERNAME_RE,
  emailGueltig,
  rotationFaellig,
  UEBERLAPPUNG_MS,
  nameGueltig,
  geraeteNameInhaltGueltig,
  meldeAnmeldung,
  type Angemeldet,
  type TokenWunsch,
  emailWirdGeaendert,
} from '../src/konto';
import type { Dienste } from '../startup/verdrahtung';
type Absage = Extract<Awaited<ReturnType<typeof anmelden>>, { ok: false }>['absage'];
/** Sitzung, Token und Antwort — derselbe Weg nach Passwort und Passkey. Token
 * ODER Sitzung: Die Sitzung trüge die vollen Rechte am Scope des Tokens vorbei. */
async function angemeldetAntworten(
  d: Dienste,
  req: Request,
  res: Response,
  user: Angemeldet,
  wunsch: TokenWunsch,
  mitToken: boolean,
  mitPasswort = false,
) {
  if (!mitToken)
    await establishSession(d.konto, req, {
      userId: Number(user.id),
      username: user.username,
      isAdmin: user.is_admin,
      mussPasswortAendern: user.must_change_password === true,
      // Nur nach einem Passwort, nicht nach einem Passkey allein: Grundlage der Gnadenfrist.
      ...(mitPasswort ? { passwortBestaetigtAm: Date.now() } : {}),
    });
  res.json({ success: true, ...(await d.konto.anmeldeAntwort(user, wunsch, mitToken, req.ip)) });
}

/** `zweiter_faktor` zeigt das Codefeld (oder `passkey`), `unverified` blendet
 * „E-Mail erneut senden?" ein; sendeFehler kennt beide Felder nicht. */
function anmeldungAbsagen(req: Request, res: Response, absage: Absage) {
  const { art, code, vars, unverified, zweiterFaktor, passkey } = absage;
  const status = STATUS_DER_ART[art];
  if (!zweiterFaktor && !unverified) return sendeFehler(req, res, status, code, vars);
  res.status(status).json({
    success: false,
    code,
    ...(zweiterFaktor ? { zweiter_faktor: true, ...(passkey ? { passkey: true } : {}) } : { unverified: true }),
    error: fehlerText(code, antwortSprache(req), vars),
  });
}

type GeprueftesToken = NonNullable<Awaited<ReturnType<Dienste['konto']['pruefeToken']>>['nutzer']>;

/** is_admin ist das Recht DIESES Tokens: bei Scope `app` immer false. */
async function tokenNutzer(d: Dienste, res: Response, u: GeprueftesToken) {
  const faellig = rotationFaellig(u);
  if (faellig) res.setHeader('X-Token-Rotation', 'faellig');
  return {
    success: true,
    loggedIn: true,
    user: {
      id: u.user_id,
      username: u.username,
      is_admin: u.is_admin === true,
      mustChangePassword: u.muss_passwort_aendern === true,
      zweiterFaktorPflicht: u.is_admin === true && !(await d.konto.istAktiv(u.user_id)),
    },
    token_expires: u.expires_at,
    token_last_used: u.last_used,
    token_info: {
      scope: u.scope,
      expires_at: u.expires_at,
      hard_expires_at: u.hard_expires_at ?? null,
      never_expires: u.never_expires === true,
      rotiert_am: u.rotiert_am,
      rotation_faellig: faellig,
    },
  } as const;
}

async function sitzungsNutzer(d: Dienste, req: Request, uid: number) {
  const user = await d.konto.kontoKurzVon(uid);
  if (!user) return null;
  return {
    success: true,
    loggedIn: true,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      mustChangePassword: user.must_change_password,
      zweiterFaktorPflicht: await zweiterFaktorPflicht(d.konto, req),
    },
  } as const;
}

export function baueAuthRouter(d: Dienste) {
  const { requireLoginOrToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  // Ein Wächter für Sitzung UND Token: Die App hat keine Sitzung und war mit
  // einem reinen Sitzungswächter von Routen ausgesperrt.
  const requireLogin = requireLoginOrToken;

  /** Die EINE Anmeldung für Webapp und App, damit beide dieselben Regeln erfüllen. */
  router.post(
    '/login',
    async (req: OffeneAnfrage<'POST /api/v1/auth/login'>, res: Antwort<'POST /api/v1/auth/login'>) => {
      const { username, password, code: zweiterCode, ohne_token, passkey } = req.eingabe;
      if (!geraeteNameInhaltGueltig(req.eingabe.label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
      const pruefung = await anmelden(d.konto, req, username, password, zweiterCode, passkey);
      if (!pruefung.ok) return anmeldungAbsagen(req, res, pruefung.absage);
      await angemeldetAntworten(d, req, res, pruefung.user as Angemeldet, req.eingabe, ohne_token !== true, true);
    },
  );

  /** Sitzung beenden UND Token entwerten, damit ein Aufruf beides wegräumt. */
  router.post(
    '/logout',
    async (req: OffeneAnfrage<'POST /api/v1/auth/logout'>, res: Antwort<'POST /api/v1/auth/logout'>) => {
      const auth = String(req.headers.authorization || '');
      // Ein Fehler geht an den Client: Hiesse die Abmeldung gelungen, bliebe der Token gültig.
      if (auth.startsWith('Bearer ')) await d.konto.deleteToken(auth.slice(7));
      // destroy gibt es nur mit Sitzungs-Middleware; die App ruft ohne Cookie auf.
      if (req.session?.destroy)
        return req.session.destroy(() => {
          // Offene Ströme dieser Sitzung prüfen sofort, nicht erst im nächsten Takt.
          meldeZugangsAenderung();
          res.clearCookie(sitzungsKeksName(), sitzungsKeksOptionen()).json({ success: true });
        });
      res.json({ success: true });
    },
  );

  /** Sitzung ODER Token; ohne Anmeldung 200 für den Browser, 401 bei Token. */
  router.get('/me', async (req: OffeneAnfrage<'GET /api/v1/auth/me'>, res: Antwort<'GET /api/v1/auth/me'>) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const antworte = async () => {
      const sitzung = req.session?.userId ? await sitzungsNutzer(d, req, req.session.userId) : null;
      if (sitzung) return res.json(sitzung);
      const p = token ? await d.konto.pruefeToken(token, { ip: req.ip }) : { nutzer: null };
      if (p.nutzer) return res.json(await tokenNutzer(d, res, p.nutzer));
      if (!token) return res.json({ success: true, loggedIn: false, user: null });
      const code = 'grund' in p && p.grund ? p.grund : 'token_ungueltig';
      res.status(code === 'zu_viele_anfragen' ? 429 : 401).json({
        success: false,
        loggedIn: false,
        user: null,
        code,
        error: fehlerText(code, antwortSprache(req), code === 'zu_viele_anfragen' ? { minuten: 1 } : undefined),
      });
    };
    await antworte().catch((e: unknown) => {
      // Ein Lesefehler ist keine Abmeldung: Mit 401 oder „nicht angemeldet“
      // verwürfe die App ihren Token, und der Browser zeigte die Anmeldemaske.
      meldeFehler('auth:me', e);
      if (!res.headersSent) sendeFehler(req, res, 503, 'server_ausgelastet');
    });
  });

  /** Öffentlich, weil ein unbegrenzter Token nach der Pflichtfrist nur noch hier
   * gilt; die Prüfung steht deshalb hier. */
  router.post(
    '/token-rotieren',
    ipThrottle(d.konto, 'token-rotieren', 120, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/token-rotieren'>,
      res: Antwort<'POST /api/v1/auth/token-rotieren'>,
    ) => {
      const auth = String(req.headers.authorization || '');
      const alt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!alt || !(await d.konto.pruefeToken(alt, { ip: req.ip, zweck: 'rotation' })).nutzer)
        return sendeFehler(req, res, 401, 'token_ungueltig');
      const t = await d.konto.rotiereToken(alt, req.ip);
      if (t === 'laeuft') return sendeFehler(req, res, 409, 'tausch_laeuft');
      if (!t) return sendeFehler(req, res, 401, 'token_ungueltig');
      res.json({
        success: true,
        token: t.token,
        token_info: {
          scope: t.scope,
          expires_at: t.expires_at,
          hard_expires_at: t.hard_expires_at,
          never_expires: t.never_expires,
          rotiert_am: t.rotiert_am,
          rotation_faellig: false,
        },
        alt_gueltig_bis: t.alt_gueltig_bis,
        ueberlappung_sek: UEBERLAPPUNG_MS / 1000,
      });
    },
  );

  /** Nur aus einer Sitzung, mit Passwort und zweitem Faktor: Sonst prägte ein
   * erbeuteter Zugang einen dauerhaften. Die Mail meldet ihn dem Inhaber. */
  router.post(
    '/token-create',
    requireLogin,
    async (req: OffeneAnfrage<'POST /api/v1/auth/token-create'>, res: Antwort<'POST /api/v1/auth/token-create'>) => {
      if (!req.session?.userId) return sendeFehler(req, res, 403, 'nur_mit_sitzung');
      if (!geraeteNameInhaltGueltig(req.eingabe.label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
      const userId = angemeldeteNutzerId(req);
      if (!(await bestaetigeMitFaktor(d.konto, req, res, userId, req.eingabe.password))) return;
      const t = await d.konto.geraeteTokenAusstellen(userId, req.eingabe.label, req.eingabe.scope, req.ip);
      res.json({ success: true, token: t.token, label: t.label, never_expires: false, token_info: t.token_info });
    },
  );

  router.get(
    '/profile',
    requireLogin,
    async (req: OffeneAnfrage<'GET /api/v1/auth/profile'>, res: Antwort<'GET /api/v1/auth/profile'>) => {
      const user = await d.konto.profil(nutzerId(req)!);
      if (!user) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');
      res.json({ success: true, user });
    },
  );

  router.put(
    '/profile',
    requireLogin,
    async (req: OffeneAnfrage<'PUT /api/v1/auth/profile'>, res: Antwort<'PUT /api/v1/auth/profile'>) => {
      const { username, email, first_name, last_name, password, password_current } = req.eingabe;
      const user = await d.konto.kontoVollVon(nutzerId(req)!);
      if (!user) return sendeFehler(req, res, 404, 'benutzer_nicht_gefunden');

      // Das Passwort nur über /change-password: Nur dort werden danach alle
      // übrigen Sitzungen und Token verworfen.
      if (password) return sendeFehler(req, res, 400, 'passwort_ueber_change_password');

      // Dieselbe Regex wie Login/Register: Sonst liesse sich eine fremde E-Mail als
      // Benutzername eintragen, und der Login sucht „username ODER email".
      if (username !== undefined && !USERNAME_RE.test(String(username || '')))
        return sendeFehler(req, res, 400, 'benutzername_ungueltig');
      if (!nameGueltig(first_name) || !nameGueltig(last_name)) return sendeFehler(req, res, 400, 'name_ungueltig');

      if (emailWirdGeaendert(user, email) && !emailGueltig(email)) return sendeFehler(req, res, 400, 'email_ungueltig');
      // Jede Änderung mit Passwort (und zweitem Faktor): Über eine neue Adresse liesse
      // sich das Passwort zurücksetzen, und erst danach verrät die Vergabeprüfung, ob
      // es einen Namen oder eine Adresse schon gibt.
      if (!password_current) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
      if (!(await bestaetigeMitFaktor(d.konto, req, res, user.id, String(password_current)))) return;
      const r = await d.konto.profilAendern(user, { username, email, first_name, last_name });
      if (r.emailChanged) return res.json({ success: true, emailChanged: true, emailSent: r.emailSent ?? false });
      res.json({ success: true });
    },
  );

  // Das eigene Konto, endgültig: Passwort und, falls eingerichtet, zweiter Faktor.
  router.delete(
    '/konto',
    requireLogin,
    async (req: OffeneAnfrage<'DELETE /api/v1/auth/konto'>, res: Antwort<'DELETE /api/v1/auth/konto'>) => {
      const uid = angemeldeteNutzerId(req);
      if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
      if ((await d.konto.kontoEntfernen(uid, null)) !== 'entfernt')
        return sendeFehler(req, res, 409, 'letzter_verwalter');
      console.log(`[konto] Konto ${uid} hat sich selbst gelöscht`);
      req.session.destroy(() => res.clearCookie(sitzungsKeksName(), sitzungsKeksOptionen()).json({ success: true }));
    },
  );

  router.post(
    '/change-password',
    requireLogin,
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/change-password'>,
      res: Antwort<'POST /api/v1/auth/change-password'>,
    ) => {
      const { current, newPassword } = req.eingabe;
      if (!current || !newPassword) return sendeFehler(req, res, 400, 'alle_felder_erforderlich');
      const uid = nutzerId(req);
      if (uid == null) return sendeFehler(req, res, 401, 'nicht_angemeldet');
      if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, String(current)))) return;
      // NACH der Prüfung des alten Passworts: Ein Fremder erfährt über das neue nichts.
      // Beendet alle Zugänge, auch den eigenen; die Sitzung wird danach neu aufgebaut.
      const konto = await d.konto.eigenesPasswortAendern(uid, newPassword, req.eingabe.passkeys_widerrufen === true);
      if (req.session?.userId && konto) {
        await establishSession(d.konto, req, {
          userId: uid,
          username: konto.username,
          isAdmin: req.session.isAdmin === true,
          mussPasswortAendern: false,
          passwortBestaetigtAm: Date.now(),
        });
      }
      res.json({ success: true });
    },
  );

  // Öffentlich; die Drossel begrenzt, wie viele Challenges eine Adresse anlegt.
  router.post(
    '/passkey/anmelden/optionen',
    ipThrottle(d.konto, 'passkey-optionen', 60, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/passkey/anmelden/optionen'>,
      res: Antwort<'POST /api/v1/auth/passkey/anmelden/optionen'>,
    ) => {
      const zweck = req.eingabe.zweck === 'zweiter_faktor' ? 'zweiter_faktor' : 'anmelden';
      const optionen = await d.konto.anmeldeOptionen(zweck);
      if (!optionen) return sendeFehler(req, res, 503, 'passkey_ohne_domain');
      res.json({ success: true, optionen });
    },
  );

  /** Die Sitzung für den Browser; einen Token nur auf `mit_token`, wie ihn die App braucht. */
  router.post(
    '/passkey/anmelden',
    ipThrottle(d.konto, 'passkey-anmelden', 30, 60 * 60 * 1000),
    async (
      req: OffeneAnfrage<'POST /api/v1/auth/passkey/anmelden'>,
      res: Antwort<'POST /api/v1/auth/passkey/anmelden'>,
    ) => {
      if (!geraeteNameInhaltGueltig(req.eingabe.label)) return sendeFehler(req, res, 400, 'geraetename_ungueltig');
      const uid = await d.konto.anmeldungPruefen(req.eingabe.antwort, 'anmelden');
      if (!uid) return sendeFehler(req, res, 401, 'passkey_ungueltig');
      const user = await d.konto.kontoVollVon(uid);
      if (!user) return sendeFehler(req, res, 401, 'passkey_ungueltig');
      const gesperrt = assertLoginAllowed(user);
      if (gesperrt) return sendeFehler(req, res, STATUS_DER_ART[gesperrt.art], gesperrt.code);
      meldeAnmeldung({ ip: req.ip, konto: user.id, zugang: 'passkey' });
      await angemeldetAntworten(d, req, res, user, req.eingabe, req.eingabe.mit_token === true);
    },
  );

  router.use(baueQrRouter(d));
  router.use(bauePasskeyRouter(d));
  router.use(baueBenutzerRouter(d));
  router.use(baueZweiterFaktorRouter(d));
  router.use(baueRegistrierungRouter(d));
  router.use(fehlerAntwort);
  return router;
}
