// Abmelden nach Stunden Leerlauf.
import { type Konfig, VORGABE } from '../infra/konfig';

export const IDLE_DEFAULT_MIN = VORGABE.sitzungLeerlaufMin;

export const sessionIdleMs = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => k.sitzungLeerlaufMin * 60_000;

/** In Sekunden für connect-pg-simple; einmal gerechnet statt an zwei Stellen. */
export const sessionIdleSec = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => Math.round(sessionIdleMs(k) / 1000);

// Die Leerlauf-Frist gleitet: Wer täglich arbeitet, bliebe sonst für immer
// angemeldet. Die Höchstdauer zählt ab der Anmeldung.
export const sessionMaxMs = (k: Pick<Konfig, 'sitzungHoechstStd'>) => k.sitzungHoechstStd * 3_600_000;

export interface Sitzungsfristen {
  maxMs: number;
  adminMaxMs: number;
  adminIdleMs: number;
}

/** Verwalter nie länger als alle anderen, auch wenn jemand die allgemeinen Fristen kürzer stellt. */
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

/** Den Leerlauf von Verwaltern misst die Sitzung selbst (der Speicher kennt eine Frist für alle),
 * höchstens einmal je Minute geschrieben, sonst speicherte jede Anfrage die Sitzung neu. */
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
