/**
 * Die HTTP-Seite der Anmeldung: Sitzung anlegen, Konto aus Cookie oder
 * Bearer-Token lesen, Wächter und Bremsen als Middleware. Die Regeln selbst
 * stehen in den Diensten (src/konto/auth.ts, loginLimiter.ts); hier wird nur
 * aus dem Request gelesen und in die Antwort geschrieben.
 */
import type { Request, Response, NextFunction } from 'express';
import { pruefeToken, rotationFaellig, pruefeAnmeldedaten } from '../auth';
import type { TokenPruefung, AnmeldeErgebnis } from '../auth';
import { zaehleAnfrage } from '../loginLimiter';
import { pruefeBestaetigung, pruefeCodeBestaetigung } from '../passwortBestaetigung';
import { sendeFehler } from '../../infra/fehlerTexte';
import { meldeUndLiefere } from '../../infra/httpError';

/**
 * Die Adresse, nach der die Bremsen zählen. req.ip statt X-Forwarded-For:
 * Express wertet den Kopf nur aus, wenn er von einem vertrauten Proxy kommt.
 * Ausführlich: docs/begruendungen/src/konto/loginLimiter.ts.md#ipof
 */
export function adresse(req: Request): string {
  return req.ip || req.socket?.remoteAddress || '?';
}

/** Anmeldedaten prüfen, gezählt nach der Adresse dieser Anfrage. */
export function anmelden(req: Request, username: unknown, password: unknown, code?: unknown,
                         passkeyAntwort?: unknown): Promise<AnmeldeErgebnis> {
  return pruefeAnmeldedaten({ ip: adresse(req) }, username, password, code, passkeyAntwort);
}

/**
 * Session-ID erneuern und danach die Anmeldedaten hineinschreiben (gegen
 * Session-Fixation); sofort speichern, damit eine unmittelbar folgende
 * Anfrage die neue ID schon kennt.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#establishsession
 */
export function establishSession(req: Request, data: { userId: number; username: string; isAdmin: boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!req.session?.regenerate) {
      // Nur in Tests ohne express-session: Im Betrieb steht die Middleware davor.
      Object.assign(req.session || (req.session = {} as typeof req.session), data, { angemeldetAm: Date.now() });
      return resolve(undefined);
    }
    req.session.regenerate((err?: Error) => {
      if (err) return reject(err);
      Object.assign(req.session, data, { angemeldetAm: Date.now() });
      req.session.save((e2?: Error) => (e2 ? reject(e2) : resolve(undefined)));
    });
  });
}

/**
 * Ermittelt die Kennung aus Session oder Bearer-Token. Abgelegt wird der ganze
 * Nutzer, nicht nur die Kennung: Sonst wüsste ein Handler zwar WER fragt,
 * aber nicht, ob es ein Verwalter ist.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#resolveuserid
 */
export async function resolveUserId(req: Request): Promise<number | null> {
  if (req.session?.userId) return req.session.userId;
  const auth = req.headers.authorization || '';
  const token: string | null = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const pruefung = await pruefeToken(token, { ip: req.ip })
    .catch(meldeUndLiefere<TokenPruefung>('auth:validateToken', { nutzer: null }));
  const user = pruefung.nutzer;
  if (pruefung.grund) req.tokenAbsage = pruefung.grund;
  // Der Hinweis reist mit jeder Antwort; die App tauscht dann von selbst.
  if (user && rotationFaellig(user)) req.res?.setHeader('X-Token-Rotation', 'faellig');
  if (user) req.apiUser = { ...user, is_admin: user.is_admin ? 1 : 0 };
  return user ? user.user_id : null;
}

/**
 * Middleware: Session ODER Bearer-Token, setzt req.tokenUserId.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#loginortokenguard
 * @param opts.timeoutMs Antwortet nach dieser Zeit mit 503, statt zu warten.
 */
export function loginOrTokenGuard(opts: { timeoutMs?: number } = {}) {
  return async function requireLoginOrToken(req: Request, res: Response, next: NextFunction) {
    if (req.session?.userId || req.tokenUserId) return next();
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!res.headersSent) sendeFehler(req, res, 503, 'server_ausgelastet');
        }, opts.timeoutMs)
      : null;
    let uid: number | null = null;
    try { uid = await resolveUserId(req); } catch (_) { uid = null; }
    if (timer) clearTimeout(timer);
    if (res.headersSent) return;               // Zeitlimit war schneller
    if (uid) { req.tokenUserId = uid; return next(); }
    return sendeFehler(req, res, 401, req.tokenAbsage ?? 'nicht_angemeldet');
  };
}

export const requireLoginOrToken = loginOrTokenGuard();

/**
 * Wer fragt hier? — Sitzung ODER Bearer-Token, EINE Antwort.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#nutzerid
 */
export function nutzerId(req: Request): number | null {
  const roh = req.session?.userId ?? req.tokenUserId ?? req.apiUser?.user_id;
  if (roh == null) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? n : null;
}

/**
 * Wie nutzerId, aber für Handler HINTER einem Wächter: Fehlt die Anmeldung,
 * ist die Verdrahtung falsch, nicht die Anfrage.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#angemeldetenutzerid
 */
export function angemeldeteNutzerId(req: Request): number {
  const id = nutzerId(req);
  if (id == null) {
    throw new Error('angemeldeteNutzerId ohne Anmeldung — die Route steht vor ihrem Waechter');
  }
  return id;
}

/**
 * Wie heisst der Anfragende? — Sitzung ODER Bearer-Token.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#nutzername
 */
export function nutzerName(req: Request): string | null {
  return req.session?.username ?? req.apiUser?.username ?? null;
}

/** Kam die Anfrage mit einer Browser-Sitzung (nicht mit einem Token)? Für Schritte, die nur dort gehen. */
export function perSitzung(req: Request): boolean {
  return !!req.session?.userId;
}

export function istVerwalter(req: Request): boolean {
  if (req.session?.isAdmin) return true;
  return !!req.apiUser?.is_admin;
}

/**
 * Bremse je Adresse für /register, /forgot-password, /reset-password,
 * /qr-login und /serverbeweis.
 */
export function ipThrottle(bucket: string, max: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const st = await zaehleAnfrage(bucket, adresse(req), windowMs);
    if (st.count > max)
      return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: st.waitMin });
    next();
  };
}

/** Aktuelles Passwort bestätigen; antwortet selbst, wenn es nicht stimmt. */
export async function bestaetigePasswort(req: Request, res: Response, uid: number, passwort: unknown,
                                         zusatz: { zweiterFaktor?: unknown } = {}): Promise<boolean> {
  const absage = await pruefeBestaetigung(uid, passwort, zusatz);
  if (absage) sendeFehler(req, res, absage.status, absage.code, absage.vars);
  return !absage;
}

/** Nur den Code des zweiten Faktors bestätigen; antwortet selbst bei Absage. */
export async function bestaetigeCode(req: Request, res: Response, uid: number, code: unknown): Promise<boolean> {
  const absage = await pruefeCodeBestaetigung(uid, code);
  if (absage) sendeFehler(req, res, absage.status, absage.code, absage.vars);
  return !absage;
}
