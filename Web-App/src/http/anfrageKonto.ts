import type { Request, Response, NextFunction } from 'express';
import { imNamenVon, type KontoQuelle } from '../infra/anfrageKonto';

/** Für Zähler tief unten, die keinen Request sehen (src/infra/anfrageKonto.ts). */
export function merkeAnfrage(req: Request, _res: Response, next: NextFunction): void {
  imNamenVon(req as KontoQuelle, next);
}
