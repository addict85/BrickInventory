/** Gedrosselt, weil jede Anfrage sonst eine Zeile in user_sessions schriebe.
 * Ausführlich: docs/begruendungen/src/konto/sitzungsBeruehrung.ts.md#abschnitt */

import { SITZUNG_LEERLAUF_MS } from './sitzungsFrist';

// Ausführlich: docs/begruendungen/src/konto/sitzungsBeruehrung.ts.md#beruehren-ms
export const BERUEHREN_MS = Math.min(5 * 60 * 1000, Math.floor(SITZUNG_LEERLAUF_MS / 4));

/** Beim Überlaufen leeren statt einzeln aufräumen: Ein verworfener Eintrag
 * kostet genau ein zusätzliches UPDATE. */
const MAX_SITZUNGEN = 1000;

interface Speicher {
  touch?: (sid: string, sess: unknown, cb?: (err?: unknown) => void) => void;
}

// Ausführlich: docs/begruendungen/src/konto/sitzungsBeruehrung.ts.md#drossleberuehren
export function drossleBeruehren<T extends Speicher>(speicher: T, frist = BERUEHREN_MS): T {
  const echt = speicher.touch?.bind(speicher);
  if (!echt) return speicher;

  const zuletzt = new Map<string, number>();
  speicher.touch = function (sid: string, sess: unknown, cb?: (err?: unknown) => void) {
    const jetzt = Date.now();
    const vorher = zuletzt.get(sid);
    if (vorher !== undefined && jetzt - vorher < frist) return cb?.();
    if (zuletzt.size >= MAX_SITZUNGEN) zuletzt.clear();
    zuletzt.set(sid, jetzt);
    return echt(sid, sess, cb);
  };
  return speicher;
}
