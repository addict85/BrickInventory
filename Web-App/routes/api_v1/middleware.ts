/**
 * Gemeinsame Middleware der /api/v1-Module.
 *
 * requireToken: akzeptiert Session-Cookie (Webapp) ODER Bearer-Token (Android).
 * requireApiAdmin: requireToken + is_admin-Prüfung — zentral, damit kein
 * Admin-Endpoint den Check versehentlich weglassen kann (genau das war
 * bei /admin/cache-ttl passiert).
 */
import { validateToken, resolveUserId } from '../../utils/auth';
import { sendeFehler } from '../../utils/fehlerTexte';

/** Extrahiert den Bearer-Token aus dem Authorization-Header (oder null). */
export function bearerToken(req: any): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * Was unter /api/v1 ohne Anmeldung erreichbar ist (Pfad relativ zu /api/v1).
 * Alles andere verlangt sie schon am Eingang: Eine neue Route, die ihren
 * eigenen Schutz vergisst, ist damit zu und nicht offen.
 */
const OEFFENTLICH: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/settings\/theme$/],
  ['GET', /^\/auth\/(me|registration-status)$/],
  ['POST', /^\/auth\/(login|logout|qr-login|register|forgot-password|reset-password|serverbeweis)$/],
];

/** Eingang zu /api/v1: Sitzung oder Bearer-Token, ausser für OEFFENTLICH. */
export async function anmeldungAmEingang(req: any, res: any, next: any) {
  const methode = req.method === 'HEAD' ? 'GET' : req.method;
  if (OEFFENTLICH.some(([m, re]) => m === methode && re.test(req.path))) return next();
  if (req.session?.userId) {
    req.apiUser = { user_id: req.session.userId, is_admin: req.session.isAdmin ? 1 : 0, username: req.session.username };
    return next();
  }
  const uid = await resolveUserId(req).catch(() => null);
  if (!uid) return sendeFehler(req, res, 401, 'nicht_angemeldet');
  req.tokenUserId = uid;
  next();
}

export function requireToken(req: any, res: any, next: any) {
  // Schon am Eingang geprüft (anmeldungAmEingang): kein zweiter Datenbankzugriff.
  if (req.apiUser) return next();
  // Accept session cookie (webapp) OR Bearer token (Android)
  if (req.session?.userId) {
    req.apiUser = { user_id: req.session.userId, is_admin: req.session.isAdmin ? 1 : 0, username: req.session.username };
    return next();
  }
  const token = bearerToken(req);
  validateToken(token).then(user => {
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
