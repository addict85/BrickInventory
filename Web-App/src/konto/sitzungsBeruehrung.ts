/** Gedrosselt, weil jede Anfrage sonst eine Zeile in user_sessions schriebe. */

// Höchstens ein Viertel der Leerlauf-Frist, sonst fiele eine arbeitende Sitzung heraus.
export const touchMs = (idleMs: number) => Math.min(5 * 60 * 1000, Math.floor(idleMs / 4));

/** Beim Überlaufen leeren statt einzeln aufräumen: Ein verworfener Eintrag
 * kostet genau ein zusätzliches UPDATE. */
const MAX_SESSIONS = 1000;

/** S: die Sitzungsdaten des Speichers; hier nur durchgereicht, daher `never` an der Schranke. */
interface Speicher<S> {
  touch?: (sid: string, sess: S, cb?: (err?: unknown) => void) => void;
}

// Spart Schreibzugriffe je Anfrage.
export function touchThrottle<T extends Speicher<never>>(speicher: T, frist: number): T {
  const echt = speicher.touch?.bind(speicher);
  if (!echt) return speicher;

  const zuletzt = new Map<string, number>();
  speicher.touch = (sid: string, sess: never, cb?: (err?: unknown) => void) => {
    const jetzt = Date.now();
    const vorher = zuletzt.get(sid);
    if (vorher !== undefined && jetzt - vorher < frist) return cb?.();
    if (zuletzt.size >= MAX_SESSIONS) zuletzt.clear();
    zuletzt.set(sid, jetzt);
    return echt(sid, sess, cb);
  };
  return speicher;
}
