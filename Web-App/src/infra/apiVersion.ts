import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from './fehlerTexte';

/** Jede Antwort trägt beide als Kopfzeile, damit die App sagen kann, wer
 * aktualisieren muss. Erhöhen nur bei einer Änderung, die das Gegenstück bricht. */
export const API_VERSION = 2;
export const API_MIN_APP = 2;

/** Abgewiesen, bevor die App Antworten falsch liest. Ohne Kopfzeile
 * (Browser, Skripte) gilt nichts davon. */
export function appFassungPruefen(req: Request, res: Response, next: NextFunction): void {
  const roh = req.get('X-App-Api');
  const fassung = roh === undefined ? NaN : Number(roh);
  if (Number.isInteger(fassung) && fassung < API_MIN_APP) {
    return sendeFehler(req, res, 426, 'app_zu_alt', { min: API_MIN_APP });
  }
  next();
}
