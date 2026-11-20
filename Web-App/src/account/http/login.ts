/** Hier wird nur aus dem Request gelesen und in die Antwort geschrieben; die
 * Regeln stehen in src/account/loginCheck.ts und loginLimiter.ts. */
import type { Request, Response, NextFunction } from 'express';
import { rotationDue, type TokenCheck } from '../deviceToken';
import type { LoginResult } from '../loginCheck';
import type { ConfirmationRejection, Faktor } from '../passwordConfirmation';
import { createHash } from 'node:crypto';
import { routeZu } from '../../contract';
import { errorText, responseLanguage } from '../../infra/fehlerTexte';
import { reportAndDeliver } from '../../infra/fehler';
import { nutzerId, signedInUserId } from '../../http/nutzerId';
import { sendError } from '../../http/httpAntwort';
import { STATUS_THE_KIND } from '../../http/fehlerArt';
import { versuche } from '../../infra/ergebnis';
import type { AccountServices } from '../area';

/** Bis zur Einrichtung des Faktors geht nur diese (loginAtInbox); die Regel steht in openFactorRequired. */
export async function zweiterFaktorPflicht(konto: AccountServices, req: Request): Promise<boolean> {
  const uid = nutzerId(req);
  const verwalter = req.session?.userId ? !!req.session.isAdmin : !!req.apiUser?.is_admin;
  return uid !== null && (await konto.openFactorRequired(uid, verwalter));
}

/** req.ip statt X-Forwarded-For: Express wertet den Kopf nur aus, wenn er von
 * einem vertrauten Proxy kommt. */
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

/** Neue Session-ID gegen Session-Fixation; sofort speichern, damit die nächste
 * Anfrage die neue ID schon kennt. */
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
  // Ohne Antwort 0: Im Zweifel meldet der Vergleich der nächsten Anfrage ab.
  const sitzungsVersion =
    (await konto.sitzungen
      .versionFromDb(data.userId)
      .catch(reportAndDeliver<number | null>('anmeldung:sitzungsVersion', 0))) ?? 0;
  return new Promise((resolve, reject) => {
    if (!req.session?.regenerate) {
      // Nur in Tests ohne express-session: Im Betrieb steht die Middleware davor.
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

/** Gnadenfrist nach einer Passworteingabe; kurz, weil eine in dieser Zeit erbeutete
 * Sitzung sonst den Faktor setzen und das Konto aussperren könnte. */
export const PASSWORD_GRACE_PERIOD_MS = 5 * 60 * 1000;

/** Nur mit Sitzung, nie mit Token, und nur einmal: Der Aufruf verbraucht die Frist. */
export function consumeGracePeriod(req: Request): boolean {
  const s = req.session,
    am = s?.passwordConfirmedAt;
  if (!s?.userId || req.tokenUserId || typeof am !== 'number') return false;
  delete s.passwordConfirmedAt;
  const alter = Date.now() - am;
  return alter >= 0 && alter < PASSWORD_GRACE_PERIOD_MS;
}

/** Der ganze Nutzer, nicht nur die Kennung: Sonst wüsste ein Handler nicht, ob
 * es ein Verwalter ist. ?token= zählt nicht, nur der Authorization-Header. */
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
  // Der Hinweis reist mit jeder Antwort; die App tauscht dann von selbst.
  if (user && rotationDue(user)) req.res?.setHeader('X-Token-Rotation', 'faellig');
  if (user) req.apiUser = { ...user, is_admin: !!user.is_admin };
  return user ? user.user_id : null;
}

/** 429 statt 401: Bei 401 darf die App den Zugang verwerfen, und der gilt vielleicht. */
export function sendTokenRejection(req: Request, res: Response): void {
  if (req.tokenRejection === 'zu_viele_anfragen') sendError(req, res, 'zu_viele', 'zu_viele_anfragen', { minuten: 1 });
  else sendError(req, res, 'nicht_angemeldet', req.tokenRejection ?? 'nicht_angemeldet');
}

/** @param opts.timeoutMs Antwortet nach dieser Zeit mit 503: Der Fortschritts-
 *   kanal soll bei voller Datenbank nicht stauen. */
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
    if (res.headersSent) return; // Zeitlimit war schneller
    if (uid) {
      req.tokenUserId = uid;
      return next();
    }
    return sendTokenRejection(req, res);
  };
}

/** Die Rechnung steht in src/http/nutzerId: Auch die Drossel dort braucht sie,
 * und Infra darf keine HTTP-Seite importieren. Hier bleibt der Name für die Routen. */
export { nutzerId, signedInUserId };

/** Sitzung ODER Token: `req.session.username` ist bei Token-Anfragen undefined. */
export function nutzerName(req: Request): string | null {
  return req.session?.username ?? req.apiUser?.username ?? null;
}

/** Für Schritte, die nur mit Browser-Sitzung gehen. */
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

/** Bremsschlüssel des Zugangs: die Sitzung (gehasht, die ID ist ein Geheimnis)
 * oder die Token-Familie; `created_at` erbt jeder Nachfolger beim Tausch. */
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

/** Passwort, bei aktivem zweitem Faktor auch Code oder Passkey; nur für Routen
 * mit `bestaetigung` im Vertrag, die der Wächtertest einzeln prüft. */
export async function confirmWithFactor(
  konto: AccountServices,
  req: Request,
  res: Response,
  uid: number,
  passwort: string | null | undefined,
  codeField = 'code',
): Promise<boolean> {
  // Der Schlüssel, unter dem der Vertragsrouter die Route registriert hat; ein Fehler der
  // Verdrahtung, kein Fall der Anfrage, darum auch im Betrieb laut.
  const schluessel = String(res.locals.contractKey ?? '');
  if (routeZu(schluessel) && !routeZu(schluessel)?.bestaetigung)
    throw new Error(`${schluessel} bestätigt, ohne \`bestaetigung\` im Vertrag`);
  // Der geprüfte Rumpf (checkInput): Felder der Bestätigung stehen im Vertrag (bestaetigt()).
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
