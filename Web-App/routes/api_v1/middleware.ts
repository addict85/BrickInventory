/**
 * Gemeinsame Middleware der /api/v1-Module.
 *
 * requireToken: akzeptiert Session-Cookie (Webapp) ODER Bearer-Token (Android).
 * requireApiAdmin: requireToken + is_admin-Prüfung — zentral, damit kein
 * Admin-Endpoint den Check versehentlich weglassen kann (genau das war
 * bei /admin/cache-ttl passiert).
 */
import { validateToken } from '../../utils/auth';
import { sendeFehler } from '../../utils/fehlerTexte';

/** Extrahiert den Bearer-Token aus dem Authorization-Header (oder null). */
export function bearerToken(req: any): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export function requireToken(req: any, res: any, next: any) {
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
