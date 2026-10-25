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
