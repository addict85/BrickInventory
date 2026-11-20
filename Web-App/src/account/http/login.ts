/** Here we only read from the request and write into the response; the
 * rules live in src/account/loginCheck.ts and loginLimiter.ts. */
import type { Request, Response, NextFunction } from 'express';
import { rotationDue, type TokenCheck } from '../deviceToken';
import type { LoginResult } from '../loginCheck';
import type { ConfirmationRejection, Faktor } from '../passwordConfirmation';
import { createHash } from 'node:crypto';
import { routeZu } from '../../contract';
import { errorText, responseLanguage } from '../../infra/errorTexts';
import { reportAndDeliver } from '../../infra/error';
import { nutzerId, signedInUserId } from '../../http/userId';
import { sendError } from '../../http/httpResponse';
import { STATUS_THE_KIND } from '../../http/errorKind';
import { versuche } from '../../infra/result';
import type { AccountServices } from '../area';

/** Until the factor is set up only this works (loginAtInbox); the rule lives in openFactorRequired. */
export async function zweiterFaktorPflicht(konto: AccountServices, req: Request): Promise<boolean> {
  const uid = nutzerId(req);
  const verwalter = req.session?.userId ? !!req.session.isAdmin : !!req.apiUser?.is_admin;
  return uid !== null && (await konto.openFactorRequired(uid, verwalter));
}

/** req.ip instead of X-Forwarded-For: Express only evaluates the header when it comes from
 * a trusted proxy. */
export function adresse(req: Request): string {
  return req.ip || req.socket?.remoteAddress || '?';
}

export function anmelden(
  konto: AccountServices,
  req: Request,
  username: string | null | undefined,
  password: string | null | undefined,
  code?: string | number | null | undefined,
  passkeyResponse?: unknown,
): Promise<LoginResult> {
  return konto.checkCredentials({ ip: adresse(req) }, username, password, code, passkeyResponse);
}

/** New session id against session fixation; save immediately so the next
 * request already knows the new id. */
export async function establishSession(
  konto: AccountServices,
  req: Request,
  data: {
    userId: number;
    username: string;
    isAdmin: boolean;
    mussPasswortAendern?: boolean;
    passwordConfirmedAt?: number;
  },
): Promise<void> {
  // Without an answer 0: when in doubt, the comparison signs out the next request.
  const sitzungsVersion =
    (await konto.sitzungen
      .versionFromDb(data.userId)
      .catch(reportAndDeliver<number | null>('anmeldung:sitzungsVersion', 0))) ?? 0;
  return new Promise((resolve, reject) => {
    if (!req.session?.regenerate) {
      // Only in tests without express-session: in operation the middleware sits in front.
      if (!req.session) req.session = {} as typeof req.session;
      Object.assign(req.session, data, {
        angemeldetAm: Date.now(),
        sitzungsVersion,
      });
      return resolve(undefined);
    }
    req.session.regenerate((err?: Error) => {
      if (err) return reject(err);
      Object.assign(req.session, data, { angemeldetAm: Date.now(), sitzungsVersion });
      req.session.save((e2?: Error) =>
        e2
          ? reject(e2)
          : versuche('anmeldung:sitzungen-begrenzen', konto.sitzungen.limit(data.userId, req.sessionID)).then(() =>
              resolve(undefined),
            ),
      );
    });
  });
}

/** Grace period after a password entry; short, because a session captured in this time
 * could otherwise set the factor and lock out the account. */
export const PASSWORD_GRACE_PERIOD_MS = 5 * 60 * 1000;

/** Only with a session, never with a token, and only once: the call consumes the period. */
export function consumeGracePeriod(req: Request): boolean {
  const s = req.session,
    am = s?.passwordConfirmedAt;
  if (!s?.userId || req.tokenUserId || typeof am !== 'number') return false;
  delete s.passwordConfirmedAt;
  const alter = Date.now() - am;
  return alter >= 0 && alter < PASSWORD_GRACE_PERIOD_MS;
}

/** The whole user, not only the id: otherwise a handler would not know whether
 * it is an administrator. ?token= does not count, only the Authorization header. */
export async function userIdTheRequest(konto: AccountServices, req: Request): Promise<number | null> {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization || '';
  const token: string | null = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const check = await konto
    .pruefeToken(token, { ip: req.ip })
    .catch(reportAndDeliver<TokenCheck>('auth:nutzerZumToken', { nutzer: null }));
  const user = check.nutzer;
  if (check.grund) req.tokenRejection = check.grund;
  // The notice travels with every response; the app then swaps by itself.
  if (user && rotationDue(user)) req.res?.setHeader('X-Token-Rotation', 'faellig');
  if (user) req.apiUser = { ...user, is_admin: !!user.is_admin };
  return user ? user.user_id : null;
}

/** 429 instead of 401: on 401 the app may discard the access, and it may still be valid. */
export function sendTokenRejection(req: Request, res: Response): void {
  if (req.tokenRejection === 'zu_viele_anfragen') sendError(req, res, 'zu_viele', 'zu_viele_anfragen', { minuten: 1 });
  else sendError(req, res, 'nicht_angemeldet', req.tokenRejection ?? 'nicht_angemeldet');
}

/** @param opts.timeoutMs Answers with 503 after this time: the progress
 *   channel should not pile up when the database is full. */
export function loginOrTokenGuard(konto: AccountServices, opts: { timeoutMs?: number } = {}) {
  return async function requireLoginOrToken(req: Request, res: Response, next: NextFunction) {
    if (req.session?.userId || req.tokenUserId) return next();
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!res.headersSent) sendError(req, res, 'nicht_verfuegbar', 'server_ausgelastet');
        }, opts.timeoutMs)
      : null;
    let uid: number | null = null;
    try {
      uid = await userIdTheRequest(konto, req);
    } catch (_) {
      uid = null;
    }
    if (timer) clearTimeout(timer);
    if (res.headersSent) return; // the timeout was faster
    if (uid) {
      req.tokenUserId = uid;
      return next();
    }
    return sendTokenRejection(req, res);
  };
}

/** The computation lives in src/http/userId: the throttle there needs it too,
 * and infra may not import an HTTP layer. The name stays here for the routes. */
export { nutzerId, signedInUserId };

/** Session OR token: `req.session.username` is undefined for token requests. */
export function nutzerName(req: Request): string | null {
  return req.session?.username ?? req.apiUser?.username ?? null;
}

/** For steps that only work with a browser session. */
export function perSession(req: Request): boolean {
  return !!req.session?.userId;
}

export function istVerwalter(req: Request): boolean {
  if (req.session?.isAdmin) return true;
  return !!req.apiUser?.is_admin;
}

export function ipThrottle(konto: AccountServices, bucket: string, max: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const st = await konto.countRequest(bucket, adresse(req), windowMs);
    if (st.count > max) return sendError(req, res, 'zu_viele', 'zu_viele_anfragen', { minuten: st.waitMin });
    next();
  };
}

/** Brake key of the access: the session (hashed, the id is a secret)
 * or the token family; every successor inherits `created_at` on the swap. */
export function accessOf(req: Request): string {
  if (req.session?.userId)
    return `s:${createHash('sha256')
      .update(String(req.sessionID ?? ''))
      .digest('hex')
      .slice(0, 16)}`;
  const seit = req.apiUser?.created_at;
  return `t:${seit ? new Date(seit).getTime() : '?'}`;
}

function rejections(req: Request, res: Response, absage: ConfirmationRejection): void {
  const status = STATUS_THE_KIND[absage.art];
  if (!absage.passkey) {
    sendError(req, res, absage.art, absage.code, absage.vars);
    return;
  }
  res.status(status).json({
    success: false,
    code: absage.code,
    passkey: true,
    error: errorText(absage.code, responseLanguage(req), absage.vars),
  });
}

/** Password, with an active second factor also code or passkey; only for routes
 * with `bestaetigung` in the contract, which the guard test checks individually. */
export async function confirmWithFactor(
  konto: AccountServices,
  req: Request,
  res: Response,
  uid: number,
  passwort: string | null | undefined,
  codeField = 'code',
): Promise<boolean> {
  // The key under which the contract router registered the route; an error of the
  // wiring, not a case of the request, hence loud in operation too.
  const schluessel = String(res.locals.contractKey ?? '');
  if (routeZu(schluessel) && !routeZu(schluessel)?.bestaetigung)
    throw new Error(`${schluessel} bestätigt, ohne \`bestaetigung\` im Vertrag`);
  // The checked body (checkInput): the confirmation fields are in the contract (bestaetigt()).
  const eingabe = (req as Request & { eingabe?: Record<string, unknown> }).eingabe ?? {};
  const faktor = { code: eingabe[codeField], passkey: eingabe.passkey } as Faktor;
  const absage = await konto.checkConfirmation(uid, accessOf(req), passwort, faktor);
  if (absage) rejections(req, res, absage);
  return !absage;
}

export async function confirmCode(
  konto: AccountServices,
  req: Request,
  res: Response,
  uid: number,
  code: string | number | null | undefined,
): Promise<boolean> {
  const absage = await konto.checkCodeConfirmation(uid, accessOf(req), code);
  if (absage) rejections(req, res, absage);
  return !absage;
}
