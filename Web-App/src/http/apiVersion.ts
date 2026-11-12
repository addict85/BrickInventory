import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from './httpAntwort';
import { API_MIN_APP } from '../vertrag/version';
export { API_VERSION, API_MIN_APP } from '../vertrag/version';

/** Abgewiesen, bevor die App Antworten falsch liest. Ohne Kopfzeile
 * (Browser, Skripte) gilt nichts davon. */
export function appFassungPruefen(req: Request, res: Response, next: NextFunction): void {
  const roh = req.get('X-App-Api');
  const fassung = roh === undefined ? NaN : Number(roh);
  if (Number.isInteger(fassung) && fassung < API_MIN_APP) {
    sendeFehler(req, res, 426, 'app_zu_alt', { min: API_MIN_APP });
    return;
  }
  next();
}
