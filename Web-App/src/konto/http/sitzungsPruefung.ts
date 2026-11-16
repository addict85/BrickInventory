import type { Request, Response, NextFunction } from 'express';
import type { KontoDienste } from '../bereich';
import { Fachfehler } from '../../infra/fehlerTexte';
import { meldeFehler } from '../../infra/fehler';

/** Ein Lesefehler ist keine Abmeldung: 503 wie /auth/me, Browser und App versuchen es wieder. */
function ausgelastet(e: unknown): Fachfehler {
  meldeFehler('sitzung:version', e);
  return new Fachfehler('nicht_verfuegbar', 'server_ausgelastet');
}

/** regenerate statt destroy: Eine Anmeldung mit dem alten Keks braucht eine leere Sitzung. */
export function sitzungsVersionPruefen(konto: KontoDienste) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = req.session;
    if (!s?.userId) return next();
    try {
      if ((await konto.sitzungen.aktuelleVersion(s.userId)) === (s.sitzungsVersion ?? 0)) return next();
    } catch (e) {
      return next(ausgelastet(e));
    }
    s.regenerate((e?: unknown) => next(e));
  };
}
