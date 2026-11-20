/** Anmeldung, Token und Profil unter /api/v1/auth; die Teilrouter aus routes/auth/ hängen dahinter. */
import { guardFor } from './api_v1/middleware';
import { cookieStaysFrom, sitzungsKeksName, sessionCookieOptions } from '../src/http/sitzungsKeks';
import { reportError } from '../src/infra/error';
import {
  anmelden,
  establishSession,
  nutzerId,
  signedInUserId,
  ipThrottle,
  confirmWithFactor,
  zweiterFaktorPflicht,
} from '../src/account/http/login';
import type { Request, Response } from 'express';
import { reportAccessChange } from '../src/account/http/accessWatch';
import { errorText, responseLanguage, fachfehler, notFound, Fachfehler } from '../src/infra/errorTexts';
import { buildUserRouter } from './auth/users';
import { buildSecondFactorRouter } from './auth/secondFactor';
import { buildRegistrationRouter } from './auth/registration';
import { buildQrRouter } from './auth/qr';
import { buildPasskeyRouter } from './auth/passkey';
import { vertragsRouter } from '../src/http/contractRouter';
import {
  assertLoginAllowed,
  USERNAME_RE,
  emailValid,
  rotationDue,
  OVERLAP_MS,
  nameValid,
  devicesNameContentValid,
  reportLogin,
  emailBecomesChanged,
  type Angemeldet,
  type TokenWish,
} from '../src/account';
import type { Dienste } from '../src/services';
type Absage = Extract<Awaited<ReturnType<typeof anmelden>>, { ok: false }>['absage'];
/** Derselbe Weg nach Passwort und Passkey. Token ODER Sitzung: Die Sitzung trüge die Rechte am Scope des Tokens
 * vorbei. keks_fehlt immer, auch als false: Dann rät die Oberfläche bei einem 401 nicht auf „ohne HTTPS“. */
async function signedInResponses(
  d: Pick<Dienste, 'account'>,
  req: Request,
  res: Response,
  user: Angemeldet,
  wish: TokenWish,
  withToken: boolean,
  withPassword = false,
) {
  await d.account.verwalter.cancelTakeovers(Number(user.id));
  if (!withToken)
    await establishSession(d.account, req, {
      userId: Number(user.id),
      username: user.username,
      isAdmin: user.is_admin,
      mussPasswortAendern: user.must_change_password === true,
      // Nur nach einem Passwort, nicht nach einem Passkey allein: Grundlage der Gnadenfrist.
      ...(withPassword ? { passwordConfirmedAt: Date.now() } : {}),
    });
  res.json({
    success: true,
    ...(await d.account.loginResponse(user, wish, withToken, req.ip)),
    keks_fehlt: !withToken && cookieStaysFrom(req),
  });
}

/** `zweiter_faktor` zeigt das Codefeld (oder `passkey`), `unverified` blendet „E-Mail erneut senden?" ein. */
function loginRejections(absage: Absage): never {
  const { art, code, vars, unverified, zweiterFaktor, passkey } = absage;
  const zusatz = zweiterFaktor
    ? { zweiter_faktor: true, ...(passkey ? { passkey: true } : {}) }
    : unverified
      ? { unverified: true }
      : undefined;
  throw new Fachfehler(art, code, vars, zusatz);
}

type CheckedToken = NonNullable<Awaited<ReturnType<Dienste['account']['pruefeToken']>>['nutzer']>;

/** is_admin ist das Recht DIESES Tokens: bei Scope `app` immer false. */
async function tokenUser(d: Pick<Dienste, 'account'>, res: Response, u: CheckedToken) {
  const faellig = rotationDue(u);
  if (faellig) res.setHeader('X-Token-Rotation', 'faellig');
  return {
    success: true,
    loggedIn: true,
    user: {
      id: u.user_id,
      username: u.username,
      is_admin: u.is_admin === true,
      mustChangePassword: u.muss_passwort_aendern === true,
      zweiterFaktorPflicht: await d.account.openFactorRequired(u.user_id, u.is_admin === true),
    },
    token_expires: u.expires_at,
    token_last_used: u.last_used,
    token_info: {
      scope: u.scope,
      expires_at: u.expires_at,
      hard_expires_at: u.hard_expires_at ?? null,
      never_expires: u.never_expires === true,
      rotated_at: u.rotated_at,
      rotation_faellig: faellig,
    },
  } as const;
}

async function sessionUser(d: Pick<Dienste, 'account'>, req: Request, uid: number) {
  const user = await d.account.accountShortOf(uid);
  if (!user) return null;
  return {
    success: true,
    loggedIn: true,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      mustChangePassword: user.must_change_password,
      zweiterFaktorPflicht: await zweiterFaktorPflicht(d.account, req),
    },
  } as const;
}

export function buildAuthRouter(d: Pick<Dienste, 'settings' | 'mail' | 'account' | 'factors' | 'profile'>) {
  const { requireLoginOrToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1/auth');

  // Ein Wächter für Sitzung UND Token: Die App hat keine Sitzung.
  const requireLogin = requireLoginOrToken;

  /** Die EINE Anmeldung für Webapp und App, damit beide dieselben Regeln erfüllen. */
  router.endpunkt('POST /api/v1/auth/login', async (req, res) => {
    const { username, password, code: secondCode, ohne_token, passkey } = req.eingabe;
    if (!devicesNameContentValid(req.eingabe.label)) fachfehler('ungueltig', 'geraetename_ungueltig');
    const check = await anmelden(d.account, req, username, password, secondCode, passkey);
    if (!check.ok) loginRejections(check.absage);
    await signedInResponses(d, req, res, check.user as Angemeldet, req.eingabe, ohne_token !== true, true);
  });

  /** Sitzung beenden UND Token entwerten, damit ein Aufruf beides wegräumt. */
  router.endpunkt('POST /api/v1/auth/logout', async (req, res) => {
    const auth = String(req.headers.authorization || '');
    // Ein Fehler geht an den Client: Hiesse die Abmeldung gelungen, bliebe der Token gültig.
    if (auth.startsWith('Bearer ')) await d.account.tokenLoeschen(auth.slice(7));
    // destroy gibt es nur mit Sitzungs-Middleware; die App ruft ohne Cookie auf.
    if (req.session?.destroy) {
      req.session.destroy(() => {
        // Offene Ströme dieser Sitzung prüfen sofort, nicht erst im nächsten Takt.
        reportAccessChange();
        res.clearCookie(sitzungsKeksName(), sessionCookieOptions()).json({ success: true });
      });
      return;
    }
    return {};
  });

  /** Sitzung ODER Token; ohne Anmeldung 200 für den Browser, 401 bei Token. */
  router.endpunkt('GET /api/v1/auth/me', async (req, res) => {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const respond = async () => {
      const sitzung = req.session?.userId ? await sessionUser(d, req, req.session.userId) : null;
      if (sitzung) return res.json(sitzung);
      const p = token ? await d.account.pruefeToken(token, { ip: req.ip }) : { nutzer: null };
      if (p.nutzer) return res.json(await tokenUser(d, res, p.nutzer));
      if (!token) return res.json({ success: true, loggedIn: false, user: null });
      const code = 'grund' in p && p.grund ? p.grund : 'token_ungueltig';
      res.status(code === 'zu_viele_anfragen' ? 429 : 401).json({
        success: false,
        loggedIn: false,
        user: null,
        code,
        error: errorText(code, responseLanguage(req), code === 'zu_viele_anfragen' ? { minuten: 1 } : undefined),
      });
    };
    await respond().catch((e: unknown) => {
      // Ein Lesefehler ist keine Abmeldung: Mit 401 verwürfe die App ihren Token.
      reportError('auth:me', e);
      fachfehler('nicht_verfuegbar', 'server_ausgelastet');
    });
  });

  /** Öffentlich: Ein unbegrenzter Token gilt nach der Pflichtfrist nur noch hier. */
  router.endpunkt(
    'POST /api/v1/auth/token-rotieren',
    ipThrottle(d.account, 'token-rotieren', 120, 60 * 60 * 1000),
    async req => {
      const auth = String(req.headers.authorization || '');
      const alt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!alt || !(await d.account.pruefeToken(alt, { ip: req.ip, zweck: 'rotation' })).nutzer)
        fachfehler('nicht_angemeldet', 'token_ungueltig');
      const t = await d.account.rotateToken(alt, req.ip);
      if (!t) fachfehler('nicht_angemeldet', 'token_ungueltig');
      return {
        token: t.token,
        token_info: {
          scope: t.scope,
          expires_at: t.expires_at,
          hard_expires_at: t.hard_expires_at,
          never_expires: t.never_expires,
          rotated_at: t.rotated_at,
          rotation_faellig: false,
        },
        alt_gueltig_bis: t.alt_gueltig_bis,
        ueberlappung_sek: OVERLAP_MS / 1000,
      };
    },
  );

  /** Nur aus einer Sitzung, mit Passwort und zweitem Faktor: Sonst prägte ein
   * erbeuteter Zugang einen dauerhaften. Die Mail meldet ihn dem Inhaber. */
  router.endpunkt('POST /api/v1/auth/token-create', requireLogin, async (req, res) => {
    if (!req.session?.userId) fachfehler('verboten', 'nur_mit_sitzung');
    if (!devicesNameContentValid(req.eingabe.label)) fachfehler('ungueltig', 'geraetename_ungueltig');
    const userId = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, userId, req.eingabe.password))) return;
    const t = await d.account.devicesTokenIssue(userId, req.eingabe.label, req.eingabe.scope, req.ip);
    return { token: t.token, label: t.label, never_expires: false, token_info: t.token_info };
  });

  router.endpunkt('GET /api/v1/auth/profile', requireLogin, async req => {
    const user = await d.account.profil(nutzerId(req)!);
    if (!user) notFound('benutzer_nicht_gefunden');
    return { user };
  });

  router.endpunkt('PUT /api/v1/auth/profile', requireLogin, async (req, res) => {
    const { username, email, first_name, last_name, password, password_current } = req.eingabe;
    const user = await d.account.accountFullOf(nutzerId(req)!);
    if (!user) notFound('benutzer_nicht_gefunden');

    // Das Passwort nur über /change-password: Nur dort fallen danach alle anderen Zugänge.
    if (password) fachfehler('ungueltig', 'passwort_ueber_change_password');

    // Dieselbe Regex wie Login/Register: Sonst liesse sich eine fremde E-Mail als
    // Benutzername eintragen, und der Login sucht „username ODER email".
    if (username !== undefined && !USERNAME_RE.test(String(username || '')))
      fachfehler('ungueltig', 'benutzername_ungueltig');
    if (!nameValid(first_name) || !nameValid(last_name)) fachfehler('ungueltig', 'name_ungueltig');

    if (emailBecomesChanged(user, email) && !emailValid(email)) fachfehler('ungueltig', 'email_ungueltig');
    // Mit Passwort (und zweitem Faktor): Über eine neue Adresse liesse sich das Passwort
    // zurücksetzen; erst danach verrät die Vergabeprüfung, ob es Name oder Adresse gibt.
    if (!password_current) fachfehler('ungueltig', 'aktuelles_passwort_erforderlich');
    if (!(await confirmWithFactor(d.account, req, res, user.id, String(password_current)))) return;
    const r = await d.account.profilAendern(user, { username, email, first_name, last_name });
    if (r.emailChanged) return { emailChanged: true, emailSent: r.emailSent ?? false };
    return {};
  });

  // Das eigene Konto, endgültig: Passwort und, falls eingerichtet, zweiter Faktor.
  router.endpunkt('DELETE /api/v1/auth/konto', requireLogin, async (req, res) => {
    const uid = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    await d.account.kontoEntfernen(uid, null);
    console.log(`[konto] Konto ${uid} hat sich selbst gelöscht`);
    req.session.destroy(() => res.clearCookie(sitzungsKeksName(), sessionCookieOptions()).json({ success: true }));
  });

  router.endpunkt('POST /api/v1/auth/change-password', requireLogin, async (req, res) => {
    const { current, newPassword } = req.eingabe;
    if (!current || !newPassword) fachfehler('ungueltig', 'alle_felder_erforderlich');
    const uid = nutzerId(req);
    if (uid == null) fachfehler('nicht_angemeldet', 'nicht_angemeldet');
    if (!(await confirmWithFactor(d.account, req, res, uid, String(current)))) return;
    // NACH der Prüfung des alten Passworts: Ein Fremder erfährt über das neue nichts.
    // Beendet alle Zugänge, auch den eigenen; die Sitzung wird danach neu aufgebaut.
    const konto = await d.account.eigenesPasswortAendern(uid, newPassword, req.eingabe.passkeys_widerrufen === true);
    if (req.session?.userId && konto) {
      await establishSession(d.account, req, {
        userId: uid,
        username: konto.username,
        isAdmin: req.session.isAdmin === true,
        mussPasswortAendern: false,
        passwordConfirmedAt: Date.now(),
      });
    }
    return {};
  });

  // Öffentlich; die Drossel begrenzt, wie viele Challenges eine Adresse anlegt.
  router.endpunkt(
    'POST /api/v1/auth/passkey/anmelden/optionen',
    ipThrottle(d.account, 'passkey-optionen', 60, 60 * 60 * 1000),
    async req => {
      const zweck = req.eingabe.zweck === 'zweiter_faktor' ? 'zweiter_faktor' : 'anmelden';
      const optionen = await d.factors.authenticationOptions(zweck);
      if (!optionen) fachfehler('nicht_verfuegbar', 'passkey_ohne_domain');
      return { optionen };
    },
  );

  /** Die Sitzung für den Browser; einen Token nur auf `mit_token`, wie ihn die App braucht. */
  router.endpunkt(
    'POST /api/v1/auth/passkey/anmelden',
    ipThrottle(d.account, 'passkey-anmelden', 30, 60 * 60 * 1000),
    async (req, res) => {
      if (!devicesNameContentValid(req.eingabe.label)) fachfehler('ungueltig', 'geraetename_ungueltig');
      const uid = await d.factors.verifyAuthentication(req.eingabe.antwort, 'anmelden');
      if (!uid) fachfehler('nicht_angemeldet', 'passkey_ungueltig');
      const user = await d.account.accountFullOf(uid);
      if (!user) fachfehler('nicht_angemeldet', 'passkey_ungueltig');
      const gesperrt = assertLoginAllowed(user);
      if (gesperrt) fachfehler(gesperrt.art, gesperrt.code);
      reportLogin({ ip: req.ip, konto: user.id, zugang: 'passkey' });
      await signedInResponses(d, req, res, user, req.eingabe, req.eingabe.mit_token === true);
    },
  );

  router.attachOne(buildQrRouter(d));
  router.attachOne(buildPasskeyRouter(d));
  router.attachOne(buildUserRouter(d));
  router.attachOne(buildSecondFactorRouter(d));
  router.attachOne(buildRegistrationRouter(d));
  return router;
}
