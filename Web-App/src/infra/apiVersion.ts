import type { Request, Response, NextFunction } from 'express';
import { sendeFehler } from './fehlerTexte';

/**
 * Die Fassung der Schnittstelle /api/v1 — und die kleinste App-Fassung, mit
 * der dieser Server noch zusammenarbeitet. Jede Antwort trägt beide als
 * Kopfzeile; die App vergleicht mit ihrer eigenen (util/ApiVersion.kt) und
 * sagt dem Nutzer, wer aktualisieren muss. Erhöhen nur bei einer Änderung,
 * die das Gegenstück bricht.
 */
export const API_VERSION = 1;
export const API_MIN_APP = 1;

/**
 * Eine App, die eine ältere Fassung als API_MIN_APP meldet (X-App-Api), wird
 * abgewiesen, bevor sie mit Antworten arbeitet, die sie falsch liest. Ohne
 * Kopfzeile (Browser, Skripte) gilt nichts davon.
 */
export function appFassungPruefen(req: Request, res: Response, next: NextFunction): void {
  const roh = req.get('X-App-Api');
  const fassung = roh === undefined ? NaN : Number(roh);
  if (Number.isInteger(fassung) && fassung < API_MIN_APP) {
    return sendeFehler(req, res, 426, 'app_zu_alt', { min: API_MIN_APP });
  }
  next();
}
