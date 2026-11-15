// Abmelden nach Stunden Leerlauf.
import { type Konfig, VORGABE } from '../infra/konfig';

export const LEERLAUF_VORGABE_MIN = VORGABE.sitzungLeerlaufMin;

export const sitzungLeerlaufMs = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => k.sitzungLeerlaufMin * 60_000;

/** In Sekunden für connect-pg-simple; einmal gerechnet statt an zwei Stellen. */
export const sitzungLeerlaufSek = (k: Pick<Konfig, 'sitzungLeerlaufMin'>) => Math.round(sitzungLeerlaufMs(k) / 1000);

// Die Leerlauf-Frist gleitet: Wer täglich arbeitet, bliebe sonst für immer
// angemeldet. Die Höchstdauer zählt ab der Anmeldung.
export const sitzungHoechstMs = (k: Pick<Konfig, 'sitzungHoechstStd'>) => k.sitzungHoechstStd * 3_600_000;

export interface Sitzungsfristen {
  hoechstMs: number;
  verwalterHoechstMs: number;
  verwalterLeerlaufMs: number;
}

/** Verwalter nie länger als alle anderen, auch wenn jemand die allgemeinen Fristen kürzer stellt. */
export const sitzungsfristen = (
  k: Pick<
    Konfig,
    'sitzungHoechstStd' | 'sitzungLeerlaufMin' | 'sitzungVerwalterHoechstStd' | 'sitzungVerwalterLeerlaufMin'
  >,
): Sitzungsfristen => ({
  hoechstMs: sitzungHoechstMs(k),
  verwalterHoechstMs: Math.min(k.sitzungVerwalterHoechstStd, k.sitzungHoechstStd) * 3_600_000,
  verwalterLeerlaufMs: Math.min(k.sitzungVerwalterLeerlaufMin, k.sitzungLeerlaufMin) * 60_000,
});

type SitzungMitFrist = {
  userId?: number;
  isAdmin?: boolean;
  angemeldetAm?: number;
  zuletztAm?: number;
  destroy(f: (e?: unknown) => void): void;
};

/** Den Leerlauf von Verwaltern misst die Sitzung selbst (der Speicher kennt eine Frist für alle),
 * höchstens einmal je Minute geschrieben, sonst speicherte jede Anfrage die Sitzung neu. */
export function sitzungsHoechstdauer(f: Sitzungsfristen) {
  return (req: { session?: SitzungMitFrist }, _res: unknown, next: (e?: unknown) => void) => {
    const s = req.session;
    if (!s?.userId) return next();
    const jetzt = Date.now();
    const verwalter = s.isAdmin === true;
    if (typeof s.angemeldetAm !== 'number') s.angemeldetAm = jetzt;
    if (verwalter && typeof s.zuletztAm !== 'number') s.zuletztAm = jetzt;
    const zuletzt = s.zuletztAm ?? jetzt;
    const zuAlt = jetzt - s.angemeldetAm > (verwalter ? f.verwalterHoechstMs : f.hoechstMs);
    if (zuAlt || (verwalter && jetzt - zuletzt > f.verwalterLeerlaufMs)) return s.destroy((e?: unknown) => next(e));
    if (verwalter && jetzt - zuletzt >= Math.min(60_000, f.verwalterLeerlaufMs / 4)) s.zuletztAm = jetzt;
    next();
  };
}
