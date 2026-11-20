import type { Request, Response, NextFunction } from 'express';
import { sendError } from './httpResponse';
import { API_MIN_APP } from '../contract/version';
export { API_VERSION, API_MIN_APP } from '../contract/version';

/** Abgewiesen, bevor die App Antworten falsch liest. Ohne Kopfzeile
 * (Browser, Skripte) gilt nichts davon. */
export function checkAppVersion(req: Request, res: Response, next: NextFunction): void {
  const roh = req.get('X-App-Api');
  const fassung = roh === undefined ? NaN : Number(roh);
  if (Number.isInteger(fassung) && fassung < API_MIN_APP) {
    sendError(req, res, 'zu_alt', 'app_zu_alt', { min: API_MIN_APP });
    return;
  }
  next();
}
