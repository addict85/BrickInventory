/** requireApiAdmin bündelt Anmeldung und is_admin, damit kein Admin-Endpunkt
 * die Prüfung versehentlich weglässt. */
import { meldeUndLiefere } from '../../src/infra/httpError';
import type { Request, Response, NextFunction } from 'express';
import { validateToken } from '../../src/konto/auth';
import { resolveUserId } from '../../src/konto/http/anmeldung';
import { sendeFehler } from '../../src/infra/fehlerTexte';

export function bearerToken(req: any): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Alles andere verlangt die Anmeldung schon am Eingang: Eine neue Route, die
 * ihren eigenen Schutz vergisst, ist damit zu und nicht offen. */
const OEFFENTLICH: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/settings\/theme$/],
  ['GET', /^\/auth\/(me|registration-status)$/],
  // token-rotieren prüft selbst: Ein unbegrenzter Token nach der Pflichtfrist
  // gilt nur noch dort, und das kann der Eingang nicht wissen.
  ['POST', /^\/auth\/(login|logout|qr-login|register|forgot-password|reset-password|serverbeweis|token-rotieren)$/],
  ['POST', /^\/auth\/passkey\/anmelden(\/optionen)?$/],
];

export async function anmeldungAmEingang(req: Request, res: Response, next: NextFunction) {
  const methode = req.method === 'HEAD' ? 'GET' : req.method;
  if (OEFFENTLICH.some(([m, re]) => m === methode && re.test(req.path))) return next();
  if (req.session?.userId) {
    req.apiUser = { user_id: req.session.userId, is_admin: req.session.isAdmin ? 1 : 0,
                    ...(req.session.username ? { username: req.session.username } : {}) };
    return next();
  }
  const uid = await resolveUserId(req).catch(meldeUndLiefere('eingang:resolveUserId', null));
  if (!uid) return sendeFehler(req, res, 401, req.tokenAbsage ?? 'nicht_angemeldet');
  req.tokenUserId = uid;
  next();
}

export function requireToken(req: any, res: any, next: any) {
  // Schon am Eingang geprüft: kein zweiter Datenbankzugriff.
  if (req.apiUser) return next();
  if (req.session?.userId) {
    req.apiUser = { user_id: req.session.userId, is_admin: req.session.isAdmin ? 1 : 0, username: req.session.username };
    return next();
  }
  const token = bearerToken(req);
  validateToken(token, { ip: req.ip }).then(user => {
    if (!user) return sendeFehler(req, res, 401, 'token_ungueltig');
    req.apiUser = user;
    next();
  }).catch(() => sendeFehler(req, res, 401, 'auth_fehler'));
}

export function requireApiAdmin(req: any, res: any, next: any) {
  requireToken(req, res, () => {
    if (!req.apiUser?.is_admin) return sendeFehler(req, res, 403, 'nur_admins');
    next();
  });
}
