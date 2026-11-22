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
  userId,
  secondFactorRequired,
} from '../../src/account/http/login';
import { receiptsAccountSpace, type Gate } from '../../src/http/accountLimit';
import { requireRelease } from '../../src/account/http/stepGuard';
import type { Sicht } from '../../src/household';

/** Who is asking and which accounts they chose; the service resolves the scope. */
export const viewOf = (req: AuthedRequest & { queryArgs: { accounts?: string | undefined } }): Sicht => ({
  user: req.apiUser.user_id,
  accounts: req.queryArgs.accounts,
});
import { sendError } from '../../src/http/httpResponse';
import { DomainError, failDomain } from '../../src/infra/errorTexts';
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
  'GET /setup/state',
  'GET /auth/me',
  'GET /auth/registration-status',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/qr-login',
  'POST /auth/qr-login/collect',
  'POST /auth/qr-login/discard',
  'POST /auth/register',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/resend-confirmation',
  'POST /auth/confirm-email',
  'POST /auth/confirm-email/preview',
  // Checks itself: an unlimited token after the mandatory deadline only applies there.
  'POST /auth/rotate-token',
  'POST /auth/cancel-takeover',
  'POST /auth/approve-login',
  'POST /auth/passkey/login',
  'POST /auth/passkey/login/options',
];
const PUBLIC = new Set(PUBLIC_ROUTES);

/** `pfad` relative to /api/v2; HEAD counts as GET. */
export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC.has(`${method === 'HEAD' ? 'GET' : method} ${path}`);
}

/** Start password or one set by an administrator: until it is replaced, only the change works.
 * The server only accepts the device key right after login, so here as well. */
const BEFORE_SWITCH = /^\/(auth\/(change-password|logout)|device\/key)$/;
/** An administrator without a second factor only gets as far as setting it up. */
const TO_SETUP: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/auth\/(me|second-factor)$/],
  ['POST', /^\/auth\/(change-password|second-factor\/(setup|confirm))$/],
  // Setting it up in the app requires the step guard (src/account/http/stepGuard.ts).
  ['POST', /^\/device\/(key|step\/(challenge|approval))$/],
];

/** The guards of the entrance, built from the account services: the entrance
 * (startup/app.ts) and every router take the same ones. */
export function guardFor(account: AccountServices) {
  return { ...inboxFor(account), ...tokenGuardFor(account), requireLoginOrToken: loginOrTokenGuard(account) };
}

function inboxFor(account: AccountServices) {
  /** Sessions from before the field ask the database once and remember it. */
  async function switchMust(req: Request): Promise<boolean> {
    if (!req.session?.userId) return req.apiUser?.must_change_password === true;
    req.session.mustChangePassword ??= await account.passwordSwitchDue(req.session.userId);
    return req.session.mustChangePassword;
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
      const uid = await userIdTheRequest(account, req);
      if (!uid) return sendTokenRejection(req, res);
      req.tokenUserId = uid;
    }
    return inboundLock(req, res, next);
  }

  /** The blocks "password change required" and "second factor mandatory" for an already
   * recognized user. Files and image proxy hang in front of it too, because they sit before the
   * entrance and would otherwise slip past both rules. */
  async function inboundLock(req: Request, _res: Response, next: NextFunction) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (!(method === 'POST' && BEFORE_SWITCH.test(req.path)) && (await switchMust(req)))
      failDomain('forbidden', 'password_change_required');
    if (!TO_SETUP.some(([m, re]) => m === method && re.test(req.path)) && (await secondFactorRequired(account, req)))
      failDomain('forbidden', 'second_factor_mandatory');
    next();
  }

  return { loginAtInbox, inboundLock };
}

function tokenGuardFor(account: AccountServices) {
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
    account
      .userForToken(token, { ip: req.ip })
      .then(user => {
        if (!user) return next(new DomainError('not_signed_in', 'token_invalid'));
        req.apiUser = { ...user, is_admin: user.is_admin === true };
        next();
      })
      .catch((e: unknown) => {
        reportError('eingang:token', e);
        next(new DomainError('not_signed_in', 'auth_error'));
      });
  });

  return {
    requireToken,
    /** Without system frame: whoever goes through accounts enters it in the service (src/account/context.ts). */
    requireApiAdmin: guard<AuthedRequest>((req, res, next) => {
      requireToken(req, res, (e?: unknown) => {
        if (e) return next(e);
        if (!req.apiUser?.is_admin) return next(new DomainError('forbidden', 'admins_only'));
        // Here instead of in a path list: this way no administrator route gets past the device lock.
        requireRelease(account, req, res, next, 'admin');
      });
    }),
  };
}

const onlyIf =
  (expected: (req: Request) => boolean, step: RequestHandler): RequestHandler =>
  (req, res, next) =>
    expected(req) ? step(req, res, next) : next();
const anonymous = (req: Request) => userId(req) === null;

/** Without an account it is at most 16 KB: whoever needs longer for that only holds
 * a connection. Signed in, the server's deadline applies (uploads). */
const BODY_DEADLINE_MS = 10_000;
function bodyDeadline(req: Request, res: Response, next: NextFunction) {
  if (req.complete) return next();
  // Exception to the error path: the clock runs after next(), the chain has already moved on.
  const clock = setTimeout(() => {
    if (req.complete || res.headersSent) return;
    res.setHeader('Connection', 'close');
    sendError(req, res, 'request_timeout', 'request_too_slow');
  }, BODY_DEADLINE_MS);
  res.once('close', () => clearTimeout(clock));
  req.once('end', () => clearTimeout(clock));
  next();
}

/** Behind loginAtInbox: without an account (login, registration, reset)
 * 16 KB suffice, otherwise 256 KB; only the PDF job carries the whole part list.
 * Path ids are checked by vertragsRouter('/api/v2'), those in body and query by the last step. */
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
    if (toLargeId(req.body) || toLargeId(req.query)) failDomain('invalid', 'id_invalid');
    next();
  },
];

/** Before receiving the body: at the limit the file is not even read. */
export function accountGate(kind: Gate) {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = userId(req);
    if (uid === null) return next();
    const free = receiptsAccountSpace(kind, uid);
    if (!free) failDomain('too_many', kind === 'stream' ? 'too_many_connections' : 'upload_running');
    res.once('finish', free); // an immediately following upload would otherwise arrive before 'close'
    res.once('close', free);
    next();
  };
}
