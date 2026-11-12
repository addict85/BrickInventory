// Abmelden nach Stunden Leerlauf.
import { konfig, VORGABE } from '../infra/konfig';

export const LEERLAUF_VORGABE_MIN = VORGABE.sitzungLeerlaufMin;

export const SITZUNG_LEERLAUF_MS = konfig().sitzungLeerlaufMin * 60_000;

/** In Sekunden für connect-pg-simple; einmal gerechnet statt an zwei Stellen. */
export const SITZUNG_LEERLAUF_SEK = Math.round(SITZUNG_LEERLAUF_MS / 1000);

// Die Leerlauf-Frist gleitet: Wer täglich arbeitet, bliebe sonst für immer
// angemeldet. Die Höchstdauer zählt ab der Anmeldung.
export const SITZUNG_HOECHST_MS = konfig().sitzungHoechstStd * 3_600_000;

type SitzungMitFrist = { userId?: number; angemeldetAm?: number; destroy(f: (e?: unknown) => void): void };

/** Ältere Sitzungen ohne Anmeldezeitpunkt beginnen ihre Frist beim ersten Treffer. */
export function sitzungsHoechstdauer(hoechstMs = SITZUNG_HOECHST_MS) {
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
