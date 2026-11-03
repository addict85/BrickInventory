/** Hier wird nur aus dem Request gelesen und in die Antwort geschrieben; die
 * Regeln stehen in src/konto/auth.ts und loginLimiter.ts. */
import type { Request, Response, NextFunction } from 'express';
import { pruefeToken, rotationFaellig, pruefeAnmeldedaten } from '../auth';
import type { TokenPruefung, AnmeldeErgebnis } from '../auth';
import { zaehleAnfrage } from '../loginLimiter';
import { pruefeBestaetigung, pruefeCodeBestaetigung } from '../passwortBestaetigung';
import type { BestaetigungsAbsage, Faktor } from '../passwortBestaetigung';
import { createHash } from 'crypto';
import { konfig } from '../../infra/konfig';
import { routeZu } from '../../infra/vertrag';
import { sendeFehler, fehlerText, antwortSprache } from '../../infra/fehlerTexte';
import { meldeUndLiefere } from '../../infra/httpError';
import { sitzungsVersionAusDb } from '../sitzungsVersion';

/** req.ip statt X-Forwarded-For: Express wertet den Kopf nur aus, wenn er von
 * einem vertrauten Proxy kommt.
 * Ausführlich: docs/begruendungen/src/konto/loginLimiter.ts.md#ipof */
export function adresse(req: Request): string {
  return req.ip || req.socket?.remoteAddress || '?';
}

export function anmelden(req: Request, username: unknown, password: unknown, code?: unknown,
                         passkeyAntwort?: unknown): Promise<AnmeldeErgebnis> {
  return pruefeAnmeldedaten({ ip: adresse(req) }, username, password, code, passkeyAntwort);
}

/** Neue Session-ID gegen Session-Fixation; sofort speichern, damit die nächste
 * Anfrage die neue ID schon kennt.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#establishsession */
export async function establishSession(req: Request, data: { userId: number; username: string; isAdmin: boolean;
                                                       mussPasswortAendern?: boolean }): Promise<void> {
  // Ohne Antwort 0: Im Zweifel meldet der Vergleich der nächsten Anfrage ab.
  const sitzungsVersion = await sitzungsVersionAusDb(data.userId)
    .catch(meldeUndLiefere<number | null>('anmeldung:sitzungsVersion', 0)) ?? 0;
  return new Promise((resolve, reject) => {
    if (!req.session?.regenerate) {
      // Nur in Tests ohne express-session: Im Betrieb steht die Middleware davor.
      Object.assign(req.session || (req.session = {} as typeof req.session), data, { angemeldetAm: Date.now(), sitzungsVersion });
      return resolve(undefined);
    }
    req.session.regenerate((err?: Error) => {
      if (err) return reject(err);
      Object.assign(req.session, data, { angemeldetAm: Date.now(), sitzungsVersion });
      req.session.save((e2?: Error) => (e2 ? reject(e2) : resolve(undefined)));
    });
  });
}

/** Der ganze Nutzer, nicht nur die Kennung: Sonst wüsste ein Handler nicht, ob
 * es ein Verwalter ist. ?token= zählt nicht, nur der Authorization-Header.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#resolveuserid */
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

/** @param opts.timeoutMs Antwortet nach dieser Zeit mit 503: Der Fortschritts-
 *   kanal soll bei voller Datenbank nicht stauen. */
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

/** EINE Antwort für Sitzung und Token: Vorher stand die Frage in zwei Reihenfolgen.
 * Ausführlich: docs/begruendungen/src/konto/auth.ts.md#nutzerid */
export function nutzerId(req: Request): number | null {
  const roh = req.session?.userId ?? req.tokenUserId ?? req.apiUser?.user_id;
  if (roh == null) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? n : null;
}

/** Fehlt die Anmeldung hinter einem Wächter, ist die Verdrahtung falsch, nicht
 * die Anfrage — besser als `nutzerId(req)!` überall. */
export function angemeldeteNutzerId(req: Request): number {
  const id = nutzerId(req);
  if (id == null) {
    throw new Error('angemeldeteNutzerId ohne Anmeldung — die Route steht vor ihrem Waechter');
  }
  return id;
}

/** Sitzung ODER Token: `req.session.username` ist bei Token-Anfragen undefined. */
export function nutzerName(req: Request): string | null {
  return req.session?.username ?? req.apiUser?.username ?? null;
}

/** Für Schritte, die nur mit Browser-Sitzung gehen. */
export function perSitzung(req: Request): boolean {
  return !!req.session?.userId;
}

export function istVerwalter(req: Request): boolean {
  if (req.session?.isAdmin) return true;
  return !!req.apiUser?.is_admin;
}

export function ipThrottle(bucket: string, max: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const st = await zaehleAnfrage(bucket, adresse(req), windowMs);
    if (st.count > max)
      return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: st.waitMin });
    next();
  };
}

/** Bremsschlüssel des Zugangs: die Sitzung (gehasht, die ID ist ein Geheimnis)
 * oder die Token-Familie; `created_at` erbt jeder Nachfolger beim Tausch. */
export function zugangVon(req: Request): string {
  if (req.session?.userId) return `s:${createHash('sha256').update(String(req.sessionID ?? '')).digest('hex').slice(0, 16)}`;
  const seit = req.apiUser?.created_at;
  return `t:${seit ? new Date(seit).getTime() : '?'}`;
}

function absagen(req: Request, res: Response, absage: BestaetigungsAbsage): void {
  if (!absage.passkey) return sendeFehler(req, res, absage.status, absage.code, absage.vars);
  res.status(absage.status).json({ success: false, code: absage.code, passkey: true,
    error: fehlerText(absage.code, antwortSprache(req), absage.vars) });
}

/** Passwort, bei aktivem zweitem Faktor auch Code oder Passkey; nur für Routen
 * mit `bestaetigung` im Vertrag, die der Wächtertest einzeln prüft. */
export async function bestaetigeMitFaktor(req: Request, res: Response, uid: number, passwort: unknown,
                                          codeFeld = 'code'): Promise<boolean> {
  const schluessel = req.route ? `${req.method} ${req.baseUrl}${req.route.path}` : '';
  if (konfig().vertragPruefen && routeZu(schluessel) && !routeZu(schluessel)?.bestaetigung)
    throw new Error(`${schluessel} bestätigt, ohne \`bestaetigung\` im Vertrag`);
  const faktor: Faktor = { code: req.body?.[codeFeld], passkey: req.body?.passkey };
  const absage = await pruefeBestaetigung(uid, zugangVon(req), passwort, faktor);
  if (absage) absagen(req, res, absage);
  return !absage;
}

export async function bestaetigeCode(req: Request, res: Response, uid: number, code: unknown): Promise<boolean> {
  const absage = await pruefeCodeBestaetigung(uid, zugangVon(req), code);
  if (absage) absagen(req, res, absage);
  return !absage;
}
