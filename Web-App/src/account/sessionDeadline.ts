// Log out after hours of idleness.
import { type AppConfig, DEFAULT } from '../infra/config';

export const IDLE_DEFAULT_MIN = DEFAULT.sitzungLeerlaufMin;

export const sessionIdleMs = (k: Pick<AppConfig, 'sitzungLeerlaufMin'>) => k.sitzungLeerlaufMin * 60_000;

/** In seconds for connect-pg-simple; computed once instead of in two places. */
export const sessionIdleSec = (k: Pick<AppConfig, 'sitzungLeerlaufMin'>) => Math.round(sessionIdleMs(k) / 1000);

// The idle deadline slides: whoever works daily would otherwise stay
// logged in forever. The maximum duration counts from login.
export const sessionMaxMs = (k: Pick<AppConfig, 'sitzungHoechstStd'>) => k.sitzungHoechstStd * 3_600_000;

export interface SessionDeadlines {
  maxMs: number;
  adminMaxMs: number;
  adminIdleMs: number;
}

/** Admins never longer than everyone else, even if someone sets the general deadlines shorter. */
export const sessionDeadlines = (
  k: Pick<
    AppConfig,
    'sitzungHoechstStd' | 'sitzungLeerlaufMin' | 'sitzungVerwalterHoechstStd' | 'sitzungVerwalterLeerlaufMin'
  >,
): SessionDeadlines => ({
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
export function sessionMaxDuration(f: SessionDeadlines) {
  return (req: { session?: SessionWithDeadline }, _res: unknown, next: (e?: unknown) => void) => {
    const s = req.session;
    if (!s?.userId) return next();
    const now = Date.now();
    const admin = s.isAdmin === true;
    if (typeof s.angemeldetAm !== 'number') s.angemeldetAm = now;
    if (admin && typeof s.lastlyAt !== 'number') s.lastlyAt = now;
    const lastUsed = s.lastlyAt ?? now;
    const zuAlt = now - s.angemeldetAm > (admin ? f.adminMaxMs : f.maxMs);
    if (zuAlt || (admin && now - lastUsed > f.adminIdleMs)) return s.destroy((e?: unknown) => next(e));
    if (admin && now - lastUsed >= Math.min(60_000, f.adminIdleMs / 4)) s.lastlyAt = now;
    next();
  };
}
