/** Throttled, because otherwise every request would write a row to user_sessions. */

// At most a quarter of the idle deadline, otherwise a working session would drop out.
export const touchMs = (idleMs: number) => Math.min(5 * 60 * 1000, Math.floor(idleMs / 4));

/** Clear on overflow instead of evicting one by one: a discarded entry
 * costs exactly one additional UPDATE. */
const MAX_SESSIONS = 1000;

/** S: the store's session data; only passed through here, hence `never` at the bound. */
interface Store<S> {
  touch?: (sid: string, sess: S, cb?: (err?: unknown) => void) => void;
}

// Saves writes per request.
export function touchThrottle<T extends Store<never>>(store: T, frist: number): T {
  const echt = store.touch?.bind(store);
  if (!echt) return store;

  const lastUsed = new Map<string, number>();
  store.touch = (sid: string, sess: never, cb?: (err?: unknown) => void) => {
    const now = Date.now();
    const before = lastUsed.get(sid);
    if (before !== undefined && now - before < frist) return cb?.();
    if (lastUsed.size >= MAX_SESSIONS) lastUsed.clear();
    lastUsed.set(sid, now);
    return echt(sid, sess, cb);
  };
  return store;
}
