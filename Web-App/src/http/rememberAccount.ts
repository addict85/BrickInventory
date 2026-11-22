import type { Request, Response, NextFunction } from 'express';
import { asWebRequest, type AccountSource } from '../infra/accountContext';

/** For counters deep down and the database's row security (src/infra/accountContext.ts). */
export function rememberRequest(req: Request, _res: Response, next: NextFunction): void {
  asWebRequest(req as AccountSource, next);
}
