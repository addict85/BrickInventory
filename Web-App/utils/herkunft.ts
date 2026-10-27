/**
 * Schreibende Anfragen nur von der eigenen Seite. Das Sitzungscookie ist
 * `sameSite: lax` — das hält fremde Websites ab, aber nicht eine Nachbar-
 * Subdomain derselben Site. Browser melden die Herkunft in Sec-Fetch-Site;
 * ohne den Kopf (App, Skripte, alte Browser) bleibt es bei sameSite.
 */
import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from './fehlerTexte';

const LESEND = new Set(['GET', 'HEAD', 'OPTIONS']);

export function nurEigeneHerkunft(req: Request, res: Response, next: NextFunction) {
  if (LESEND.has(req.method)) return next();
  // Ein Bearer-Token schickt kein Browser von selbst mit.
  if (String(req.headers.authorization || '').startsWith('Bearer ')) return next();
  const herkunft = String(req.headers['sec-fetch-site'] || '');
  if (herkunft && herkunft !== 'same-origin' && herkunft !== 'none')
    return sendeFehler(req, res, 403, 'fremde_herkunft');
  next();
}
