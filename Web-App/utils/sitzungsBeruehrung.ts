/**
 * Die Ablaufzeit einer Sitzung muss nicht bei JEDER Anfrage neu geschrieben
 * werden.
 * Ausführlich: docs/begruendungen/utils/sitzungsBeruehrung.ts.md#abschnitt
 */

import { SITZUNG_LEERLAUF_MS } from './sitzungsFrist';

/**
 * Frist zwischen zwei geschriebenen Ablaufzeiten derselben Sitzung.
 * Ausführlich: docs/begruendungen/utils/sitzungsBeruehrung.ts.md#beruehren-ms
 */
export const BERUEHREN_MS = Math.min(5 * 60 * 1000, Math.floor(SITZUNG_LEERLAUF_MS / 4));

/**
 * Deckel gegen unbegrenztes Wachstum. Beim Überlaufen wird geleert statt
 * einzeln aufgeräumt — dieselbe Entscheidung wie bei _tokenCache in
 * utils/auth.ts. Ein verworfener Eintrag kostet genau ein zusätzliches UPDATE.
 */
const MAX_SITZUNGEN = 1000;

/** Ein Sitzungsspeicher, so viel wie hier gebraucht wird. */
interface Speicher {
  touch?: (sid: string, sess: unknown, cb?: (err?: unknown) => void) => void;
}

/**
 * Die touch()-Methode eines Sitzungsspeichers drosseln — an Ort und Stelle.
 * Ausführlich: docs/begruendungen/utils/sitzungsBeruehrung.ts.md#drossleberuehren
 */
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
