// Log out after hours of idleness.
import { type Konfig, VORGABE } from '../infra/config';

export const IDLE_DEFAULT_MIN = VORGABE.sitzungLeerlaufMin;

export const sessionIdleMs = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => k.sitzungLeerlaufMin * 60_000;

/** In seconds for connect-pg-simple; computed once instead of in two places. */
export const sessionIdleSec = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => Math.round(sessionIdleMs(k) / 1000);

// The idle deadline slides: whoever works daily would otherwise stay
// logged in forever. The maximum duration counts from login.
export const sessionMaxMs = (k: Pick<Konfig, 'sitzungHoechstStd'>) => k.sitzungHoechstStd * 3_600_000;

export interface Sitzungsfristen {
  maxMs: number;
  adminMaxMs: number;
  adminIdleMs: number;
}

/** Admins never longer than everyone else, even if someone sets the general deadlines shorter. */
export const sitzungsfristen = (
  k: Pick<
    Konfig,
    'sitzungHoechstStd' | 'sitzungLeerlaufMin' | 'sitzungVerwalterHoechstStd' | 'sitzungVerwalterLeerlaufMin'
  >,
): Sitzungsfristen => ({
  maxMs: sessionMaxMs(k),
  adminMaxMs: Math.min(k.sitzungVerwalterHoechstStd, k.sitzungHoechstStd) * 3_600_000,
  adminIdleMs: Math.min(k.sitzungVerwalterLeerlaufMin, k.sitzungLeerlaufMin) * 60_000,
});

type SessionWithDeadline = {
  userId?: number;
  isAdmin?: boolean;
  angemeldetAm?: number;
  lastlyAt?: number;
  destroy(f: (e?: unknown) => void): void;
};

/** The idleness of admins is measured by the session itself (the store knows one deadline for all),
 * written at most once per minute, otherwise every request would save the session anew. */
export function sessionMaxDuration(f: Sitzungsfristen) {
  return (req: { session?: SessionWithDeadline }, _res: unknown, next: (e?: unknown) => void) => {
    const s = req.session;
    if (!s?.userId) return next();
    const jetzt = Date.now();
    const verwalter = s.isAdmin === true;
    if (typeof s.angemeldetAm !== 'number') s.angemeldetAm = jetzt;
    if (verwalter && typeof s.lastlyAt !== 'number') s.lastlyAt = jetzt;
    const zuletzt = s.lastlyAt ?? jetzt;
    const zuAlt = jetzt - s.angemeldetAm > (verwalter ? f.adminMaxMs : f.maxMs);
    if (zuAlt || (verwalter && jetzt - zuletzt > f.adminIdleMs)) return s.destroy((e?: unknown) => next(e));
    if (verwalter && jetzt - zuletzt >= Math.min(60_000, f.adminIdleMs / 4)) s.lastlyAt = jetzt;
    next();
  };
}
