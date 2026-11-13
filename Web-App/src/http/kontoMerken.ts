import type { Request, Response, NextFunction } from 'express';
import { alsAnfrage, type KontoQuelle } from '../infra/kontoKontext';

/** Für Zähler tief unten und den Zeilenschutz der Datenbank (src/infra/kontoKontext.ts). */
export function merkeAnfrage(req: Request, _res: Response, next: NextFunction): void {
  alsAnfrage(req as KontoQuelle, next);
}
