/**
 * Gemeinsame Middleware der /api/v1-Module.
 *
 * requireToken: akzeptiert Session-Cookie (Webapp) ODER Bearer-Token (Android).
 * requireApiAdmin: requireToken + is_admin-Prüfung — zentral, damit kein
 * Admin-Endpoint den Check versehentlich weglassen kann (genau das war
 * bei /admin/cache-ttl passiert).
 */
import { validateToken } from '../../utils/auth';

/** Extrahiert den Bearer-Token aus dem Authorization-Header (oder null). */
export function bearerToken(req): string | null {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export function requireToken(req, res, next) {
  // Accept session cookie (webapp) OR Bearer token (Android)
  if (req.session?.userId) {
    req.apiUser = { user_id: req.session.userId, is_admin: req.session.isAdmin ? 1 : 0, username: req.session.username };
    return next();
  }
  const token = bearerToken(req);
  validateToken(token).then(user => {
    if (!user) return res.status(401).json({ success:false, error:'Ungültiger oder abgelaufener Token' });
    req.apiUser = user;
    next();
  }).catch(() => res.status(401).json({ success:false, error:'Auth-Fehler' }));
}

export function requireApiAdmin(req, res, next) {
  requireToken(req, res, () => {
    if (!req.apiUser?.is_admin) return res.status(403).json({ success: false, error: 'Nur für Admins' });
    next();
  });
}
