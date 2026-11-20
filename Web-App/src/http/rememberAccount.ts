import type { Request, Response, NextFunction } from 'express';
import { asWebRequest, type AccountSource } from '../infra/accountContext';

/** Für Zähler tief unten und den Zeilenschutz der Datenbank (src/infra/accountContext.ts). */
export function rememberRequest(req: Request, _res: Response, next: NextFunction): void {
  asWebRequest(req as AccountSource, next);
}
