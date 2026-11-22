import type { Request, Response, NextFunction } from 'express';
import type { AccountServices } from '../area';
import { DomainError } from '../../infra/errorTexts';
import { reportError } from '../../infra/error';

/** A read error is not a logout: 503 like /auth/me, browser and app try again. */
function busy(e: unknown): DomainError {
  reportError('sitzung:version', e);
  return new DomainError('nicht_verfuegbar', 'server_busy');
}

/** regenerate instead of destroy: a login with the old cookie needs an empty session. */
export function checkSessionVersion(konto: AccountServices) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = req.session;
    if (!s?.userId) return next();
    try {
      if ((await konto.sitzungen.currentVersion(s.userId)) === (s.sitzungsVersion ?? 0)) return next();
    } catch (e) {
      return next(busy(e));
    }
    s.regenerate((e?: unknown) => next(e));
  };
}
