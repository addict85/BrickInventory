/** Throttled, because otherwise every request would write a row to user_sessions. */

// At most a quarter of the idle deadline, otherwise a working session would drop out.
export const touchMs = (idleMs: number) => Math.min(5 * 60 * 1000, Math.floor(idleMs / 4));

/** Clear on overflow instead of evicting one by one: a discarded entry
 * costs exactly one additional UPDATE. */
const MAX_SESSIONS = 1000;

/** S: the store's session data; only passed through here, hence `never` at the bound. */
interface Speicher<S> {
  touch?: (sid: string, sess: S, cb?: (err?: unknown) => void) => void;
}

// Saves writes per request.
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
