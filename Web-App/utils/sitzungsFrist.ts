/**
 * Wie lange eine Webapp-Sitzung ohne Betrieb gilt.
 * Ausführlich: docs/begruendungen/utils/sitzungsFrist.ts.md#leerlauf-vorgabe-min
 */

/** Vorgabe in Minuten, falls nichts gesetzt ist. Meine Zahl, siehe oben. */
export const LEERLAUF_VORGABE_MIN = 240;

/** Die geltende Leerlauf-Frist in Millisekunden. */
export const SITZUNG_LEERLAUF_MS = (() => {
  const roh = process.env.SESSION_IDLE_MINUTES;
  if (roh === undefined || roh.trim() === '') return LEERLAUF_VORGABE_MIN * 60_000;
  const n = Number(roh.trim());
  if (!Number.isInteger(n) || n <= 0) {
    console.warn(
      `[session] SESSION_IDLE_MINUTES="${roh}" ist keine positive Minutenzahl — `
      + `es gelten ${LEERLAUF_VORGABE_MIN} Minuten.`
    );
    return LEERLAUF_VORGABE_MIN * 60_000;
  }
  return n * 60_000;
})();

/**
 * Dieselbe Frist in Sekunden — die Einheit, die connect-pg-simple als `ttl`
 * erwartet. Einmal gerechnet, damit nicht an zwei Stellen durch 1000 geteilt
 * wird.
 */
export const SITZUNG_LEERLAUF_SEK = Math.round(SITZUNG_LEERLAUF_MS / 1000);

/** Vorgabe der Höchstdauer in Stunden: eine Woche, wie der Browser-Token. */
export const HOECHSTDAUER_VORGABE_STD = 168;

// Die Leerlauf-Frist gleitet: Wer täglich arbeitet, bliebe sonst für immer
// angemeldet, und ein mitgenommenes Cookie gälte ebenso lange. Die
// Höchstdauer zählt ab der Anmeldung und verlängert sich nicht.
export const SITZUNG_HOECHST_MS = (() => {
  const roh = process.env.SESSION_MAX_HOURS;
  if (roh === undefined || roh.trim() === '') return HOECHSTDAUER_VORGABE_STD * 3_600_000;
  const n = Number(roh.trim());
  if (!Number.isInteger(n) || n <= 0) {
    console.warn(`[session] SESSION_MAX_HOURS="${roh}" ist keine positive Stundenzahl — `
      + `es gelten ${HOECHSTDAUER_VORGABE_STD} Stunden.`);
    return HOECHSTDAUER_VORGABE_STD * 3_600_000;
  }
  return n * 3_600_000;
})();

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
