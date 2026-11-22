/** The session id is a bearer secret like an app token: user_sessions only holds its
 * SHA-256 (migration 0125), the cookie the plaintext. A read of the table (backup,
 * injection) then yields no usable cookie. */
import { createHash } from 'node:crypto';

export function sessionDigest(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

type Methode = (sid: string, ...rest: never[]) => unknown;
type Speicher = { get?: Methode; set?: Methode; destroy?: Methode; touch?: Methode };

/** Every store method that takes a session id gets the hash; express-session's own
 * regenerate/load call these methods and are covered with them. */
export function hashSessionIds<T extends object>(speicher: T): T {
  const s = speicher as Speicher;
  for (const name of ['get', 'set', 'destroy', 'touch'] as const) {
    const echt = s[name]?.bind(speicher);
    if (echt) s[name] = (sid: string, ...rest: never[]) => echt(sessionDigest(sid), ...rest);
  }
  return speicher;
}
