/** The session id is a bearer secret like an app token: user_sessions only holds its
 * SHA-256 (migration 0125), the cookie the plaintext. A read of the table (backup,
 * injection) then yields no usable cookie. */
import { createHash } from 'node:crypto';

export function sessionDigest(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

type Method = (sid: string, ...rest: never[]) => unknown;
type Store = { get?: Method; set?: Method; destroy?: Method; touch?: Method };

/** Every store method that takes a session id gets the hash; express-session's own
 * regenerate/load call these methods and are covered with them. */
export function hashSessionIds<T extends object>(store: T): T {
  const s = store as Store;
  for (const name of ['get', 'set', 'destroy', 'touch'] as const) {
    const echt = s[name]?.bind(store);
    if (echt) s[name] = (sid: string, ...rest: never[]) => echt(sessionDigest(sid), ...rest);
  }
  return store;
}
