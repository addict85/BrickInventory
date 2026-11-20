import type { Request, Response, NextFunction } from 'express';
import type { AccountServices } from '../bereich';
import { Fachfehler } from '../../infra/fehlerTexte';
import { reportError } from '../../infra/fehler';

/** Ein Lesefehler ist keine Abmeldung: 503 wie /auth/me, Browser und App versuchen es wieder. */
function busy(e: unknown): Fachfehler {
  reportError('sitzung:version', e);
  return new Fachfehler('nicht_verfuegbar', 'server_ausgelastet');
}

/** regenerate statt destroy: Eine Anmeldung mit dem alten Keks braucht eine leere Sitzung. */
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
