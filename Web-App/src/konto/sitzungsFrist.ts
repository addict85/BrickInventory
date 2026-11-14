// Abmelden nach Stunden Leerlauf.
import { type Konfig, VORGABE } from '../infra/konfig';

export const LEERLAUF_VORGABE_MIN = VORGABE.sitzungLeerlaufMin;

export const sitzungLeerlaufMs = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => k.sitzungLeerlaufMin * 60_000;

/** In Sekunden für connect-pg-simple; einmal gerechnet statt an zwei Stellen. */
export const sitzungLeerlaufSek = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => Math.round(sitzungLeerlaufMs(k) / 1000);

// Die Leerlauf-Frist gleitet: Wer täglich arbeitet, bliebe sonst für immer
// angemeldet. Die Höchstdauer zählt ab der Anmeldung.
export const sitzungHoechstMs = (k: Pick<Konfig, 'sitzungHoechstStd'>) => k.sitzungHoechstStd * 3_600_000;

type SitzungMitFrist = { userId?: number; angemeldetAm?: number; destroy(f: (e?: unknown) => void): void };

/** Ältere Sitzungen ohne Anmeldezeitpunkt beginnen ihre Frist beim ersten Treffer. */
export function sitzungsHoechstdauer(hoechstMs: number) {
  return (req: { session?: SitzungMitFrist }, _res: unknown, next: (e?: unknown) => void) => {
    const s = req.session;
    if (!s?.userId) return next();
    const jetzt = Date.now();
    if (typeof s.angemeldetAm !== 'number') {
      s.angemeldetAm = jetzt;
      return next();
    }
    if (jetzt - s.angemeldetAm <= hoechstMs) return next();
    s.destroy((e?: unknown) => next(e));
  };
}
