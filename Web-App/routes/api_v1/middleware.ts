/** requireApiAdmin bundles login and is_admin, so no admin endpoint
 * accidentally omits the check. */
import { reportError } from '../../src/infra/error';
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { toLargeId } from '../../src/infra/validate';
import type { AccountServices } from '../../src/account';
import {
  loginOrTokenGuard,
  userIdTheRequest,
  sendTokenRejection,
  nutzerId,
  zweiterFaktorPflicht,
} from '../../src/account/http/login';
import { receiptsAccountSpace, type Schranke } from '../../src/http/accountLimit';
import { requireRelease } from '../../src/account/http/stepGuard';
import type { Sicht } from '../../src/household';

/** Who is asking and which accounts they chose; the service resolves the scope. */
export const viewOf = (req: AuthedRequest & { abfrage: { accounts?: string | undefined } }): Sicht => ({
  nutzer: req.apiUser.user_id,
  konten: req.abfrage.accounts,
});
import { sendError } from '../../src/http/httpResponse';
import { Fachfehler, fachfehler } from '../../src/infra/errorTexts';
import { guard } from '../../src/http/contractRouter';

export function bearerToken(req: { headers: { authorization?: string | undefined } }): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Everything else requires login right at the entrance: a new route that
 * forgets its own protection is thereby closed, not open. Exact paths instead of
 * patterns, so the Caddyfile (`@anmeldung`) and the app's sign-in screens can be held
 * against this list (test/public-entrance-db.test.js). */
export const PUBLIC_ROUTES: ReadonlyArray<string> = [
  'GET /settings/theme',
  // The login page uses it to check what is still missing before the first account.
  'GET /einrichtung/stand',
  'GET /auth/me',
  'GET /auth/registration-status',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/qr-login',
  'POST /auth/qr-login/abholen',
  'POST /auth/qr-login/verwerfen',
  'POST /auth/register',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/bestaetigung-erneut',
  'POST /auth/email-bestaetigen',
  'POST /auth/email-bestaetigen/vorschau',
  // Checks itself: an unlimited token after the mandatory deadline only applies there.
  'POST /auth/token-rotieren',
  'POST /auth/uebernahme-abbrechen',
  'POST /auth/anmeldung-freigeben',
  'POST /auth/passkey/anmelden',
  'POST /auth/passkey/anmelden/optionen',
];
const PUBLIC = new Set(PUBLIC_ROUTES);

/** `pfad` relative to /api/v1; HEAD counts as GET. */
export function isPublicRoute(methode: string, pfad: string): boolean {
  return PUBLIC.has(`${methode === 'HEAD' ? 'GET' : methode} ${pfad}`);
}

/** Start password or one set by an administrator: until it is replaced, only the change works.
 * The server only accepts the device key right after login, so here as well. */
const VOR_DEM_WECHSEL = /^\/(auth\/(change-password|logout)|geraet\/schluessel)$/;
/** An administrator without a second factor only gets as far as setting it up. */
const TO_SETUP: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/auth\/(me|zweiter-faktor)$/],
  ['POST', /^\/auth\/(change-password|zweiter-faktor\/(einrichten|bestaetigen))$/],
  // Setting it up in the app requires the step guard (src/account/http/stepGuard.ts).
  ['POST', /^\/geraet\/(schluessel|schritt\/(challenge|freigabe))$/],
];

/** The guards of the entrance, built from the account services: the entrance
 * (startup/app.ts) and every router take the same ones. */
export function guardFor(konto: AccountServices) {
  return { ...inboxFor(konto), ...tokenGuardFor(konto), requireLoginOrToken: loginOrTokenGuard(konto) };
}

function inboxFor(konto: AccountServices) {
  /** Sessions from before the field ask the database once and remember it. */
  async function switchMust(req: Request): Promise<boolean> {
    if (!req.session?.userId) return req.apiUser?.muss_passwort_aendern === true;
    req.session.mussPasswortAendern ??= await konto.passwordSwitchDue(req.session.userId);
    return req.session.mussPasswortAendern;
  }

  async function loginAtInbox(req: Request, res: Response, next: NextFunction) {
    if (isPublicRoute(req.method, req.path)) return next();
    if (req.session?.userId) {
      req.apiUser = {
        user_id: req.session.userId,
        is_admin: !!req.session.isAdmin,
        ...(req.session.username ? { username: req.session.username } : {}),
      };
    } else {
      // A read error is not an invalid login: a 401 would sign the app out.
      const uid = await userIdTheRequest(konto, req);
      if (!uid) return sendTokenRejection(req, res);
      req.tokenUserId = uid;
    }
    return inboundLock(req, res, next);
  }

  /** The blocks "password change required" and "second factor mandatory" for an already
   * recognized user. Files and image proxy hang in front of it too, because they sit before the
   * entrance and would otherwise slip past both rules. */
  async function inboundLock(req: Request, _res: Response, next: NextFunction) {
    const methode = req.method === 'HEAD' ? 'GET' : req.method;
    if (!(methode === 'POST' && VOR_DEM_WECHSEL.test(req.path)) && (await switchMust(req)))
      fachfehler('verboten', 'passwort_wechsel_noetig');
    if (!TO_SETUP.some(([m, re]) => m === methode && re.test(req.path)) && (await zweiterFaktorPflicht(konto, req)))
      fachfehler('verboten', 'zweiter_faktor_pflicht');
    next();
  }

  return { loginAtInbox, inboundLock };
}

function tokenGuardFor(konto: AccountServices) {
  const requireToken = guard<AuthedRequest>((req, _res, next) => {
    // Already checked at the entrance: no second database access.
    if (req.apiUser) return next();
    if (req.session?.userId) {
      req.apiUser = {
        user_id: req.session.userId,
        is_admin: !!req.session.isAdmin,
        ...(req.session.username ? { username: req.session.username } : {}),
      };
      return next();
    }
    const token = bearerToken(req);
    konto
      .nutzerZumToken(token, { ip: req.ip })
      .then(user => {
        if (!user) return next(new Fachfehler('nicht_angemeldet', 'token_ungueltig'));
        req.apiUser = { ...user, is_admin: user.is_admin === true };
        next();
      })
      .catch((e: unknown) => {
        reportError('eingang:token', e);
        next(new Fachfehler('nicht_angemeldet', 'auth_fehler'));
      });
  });

  return {
    requireToken,
    /** Without system frame: whoever goes through accounts enters it in the service (src/account/context.ts). */
    requireApiAdmin: guard<AuthedRequest>((req, res, next) => {
      requireToken(req, res, (e?: unknown) => {
        if (e) return next(e);
        if (!req.apiUser?.is_admin) return next(new Fachfehler('verboten', 'nur_admins'));
        // Here instead of in a path list: this way no administrator route gets past the device lock.
        requireRelease(konto, req, res, next, 'verwaltung');
      });
    }),
  };
}

const onlyIf =
  (soll: (req: Request) => boolean, schritt: RequestHandler): RequestHandler =>
  (req, res, next) =>
    soll(req) ? schritt(req, res, next) : next();
const anonymous = (req: Request) => nutzerId(req) === null;

/** Without an account it is at most 16 KB: whoever needs longer for that only holds
 * a connection. Signed in, the server's deadline applies (uploads). */
const BODY_DEADLINE_MS = 10_000;
function bodyDeadline(req: Request, res: Response, next: NextFunction) {
  if (req.complete) return next();
  // Exception to the error path: the clock runs after next(), the chain has already moved on.
  const uhr = setTimeout(() => {
    if (req.complete || res.headersSent) return;
    res.setHeader('Connection', 'close');
    sendError(req, res, 'zu_langsam', 'anfrage_zu_langsam');
  }, BODY_DEADLINE_MS);
  res.once('close', () => clearTimeout(uhr));
  req.once('end', () => clearTimeout(uhr));
  next();
}

/** Behind loginAtInbox: without an account (login, registration, reset)
 * 16 KB suffice, otherwise 256 KB; only the PDF job carries the whole part list.
 * Path ids are checked by vertragsRouter('/api/v1'), those in body and query by the last step. */
export const readBody: RequestHandler[] = [
  onlyIf(anonymous, bodyDeadline),
  onlyIf(anonymous, express.json({ limit: '16kb' })),
  onlyIf(anonymous, express.urlencoded({ extended: true, limit: '16kb' })),
  onlyIf(req => req.method === 'POST' && req.path === '/sets/partslist-pdf', express.json({ limit: '4mb' })),
  express.json({ limit: '256kb' }),
  express.urlencoded({ extended: true, limit: '256kb' }),
  (req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  }, // Express 5: otherwise undefined
  (req, _res, next) => {
    if (toLargeId(req.body) || toLargeId(req.query)) fachfehler('ungueltig', 'id_ungueltig');
    next();
  },
];

/** Before receiving the body: at the limit the file is not even read. */
export function kontoSchranke(art: Schranke) {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = nutzerId(req);
    if (uid === null) return next();
    const frei = receiptsAccountSpace(art, uid);
    if (!frei) fachfehler('zu_viele', art === 'strom' ? 'zu_viele_verbindungen' : 'upload_laeuft');
    res.once('finish', frei); // an immediately following upload would otherwise arrive before 'close'
    res.once('close', frei);
    next();
  };
}
