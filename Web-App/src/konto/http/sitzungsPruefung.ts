import type { Request, Response, NextFunction } from 'express';
import type { KontoDienste } from '../bereich';
import { Fachfehler } from '../../infra/fehlerTexte';
import { meldeFehler } from '../../infra/fehler';

/** regenerate statt destroy: Eine Anmeldung mit dem alten Keks braucht eine
 * leere Sitzung, in die sie schreiben kann. Ein Lesefehler ist keine Abmeldung und
 * kein Programmfehler: 503, wie /auth/me, damit Browser und App es später wieder versuchen. */
export function sitzungsVersionPruefen(konto: KontoDienste) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = req.session;
    if (!s?.userId) return next();
    try {
      if ((await konto.sitzungen.aktuelleVersion(s.userId)) === (s.sitzungsVersion ?? 0)) return next();
    } catch (e) {
      meldeFehler('sitzung:version', e);
      return next(new Fachfehler('nicht_verfuegbar', 'server_ausgelastet'));
    }
    s.regenerate((e?: unknown) => next(e));
  };
}
