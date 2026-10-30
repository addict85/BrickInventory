/**
 * Wie lange eine Webapp-Sitzung ohne Betrieb gilt.
 * Ausführlich: docs/begruendungen/utils/sitzungsFrist.ts.md#leerlauf-vorgabe-min
 */
import { konfig, VORGABE } from './konfig';

/** Vorgabe in Minuten, falls nichts gesetzt ist. Meine Zahl, siehe oben. */
export const LEERLAUF_VORGABE_MIN = VORGABE.sitzungLeerlaufMin;

/** Die geltende Leerlauf-Frist in Millisekunden. */
export const SITZUNG_LEERLAUF_MS = konfig().sitzungLeerlaufMin * 60_000;

/**
 * Dieselbe Frist in Sekunden — die Einheit, die connect-pg-simple als `ttl`
 * erwartet. Einmal gerechnet, damit nicht an zwei Stellen durch 1000 geteilt
 * wird.
 */
export const SITZUNG_LEERLAUF_SEK = Math.round(SITZUNG_LEERLAUF_MS / 1000);

// Die Leerlauf-Frist gleitet: Wer täglich arbeitet, bliebe sonst für immer
// angemeldet, und ein mitgenommenes Cookie gälte ebenso lange. Die
// Höchstdauer zählt ab der Anmeldung und verlängert sich nicht.
export const SITZUNG_HOECHST_MS = konfig().sitzungHoechstStd * 3_600_000;

/**
 * Beendet eine Sitzung, die älter als die Höchstdauer ist; die Anfrage läuft
 * danach als nicht angemeldet weiter. Sitzungen von vor dieser Regel tragen
 * keinen Anmeldezeitpunkt und beginnen ihre Frist beim ersten Treffer.
 */
export function sitzungsHoechstdauer(hoechstMs = SITZUNG_HOECHST_MS) {
  return (req: any, _res: any, next: (e?: unknown) => void) => {
    const s = req.session;
    if (!s?.userId) return next();
    const jetzt = Date.now();
    if (typeof s.angemeldetAm !== 'number') { s.angemeldetAm = jetzt; return next(); }
    if (jetzt - s.angemeldetAm <= hoechstMs) return next();
    s.destroy((e?: unknown) => next(e));
  };
}
