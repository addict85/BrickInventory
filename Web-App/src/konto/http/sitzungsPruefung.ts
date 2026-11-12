import type { Request, Response, NextFunction } from 'express';
import { aktuelleSitzungsVersion } from '../sitzungsVersion';

/** regenerate statt destroy: Eine Anmeldung mit dem alten Keks braucht eine
 * leere Sitzung, in die sie schreiben kann. */
export function sitzungsVersionPruefen() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = req.session;
    if (!s?.userId) return next();
    try {
      if ((await aktuelleSitzungsVersion(s.userId)) === (s.sitzungsVersion ?? 0)) return next();
    } catch (e) {
      return next(e);
    }
    s.regenerate((e?: unknown) => next(e));
  };
}
