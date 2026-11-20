/** argon2id: no limit of 72 bytes, and memory costs slow down graphics cards when guessing. Old bcrypt hashes
 * still apply until the next login replaces them (loginCheck.ts). */
import { hash, hashSync, verify } from '@node-rs/argon2';
import { bcryptPool, bcryptSchranke } from './bcryptLimit';

/** OWASP's default for argon2id (19 MiB, 2 passes); the library uses argon2id without a setting. */
export const ARGON2_COST = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const ARGON2_PREFIX = `$argon2id$v=19$m=${ARGON2_COST.memoryCost},t=${ARGON2_COST.timeCost},p=${ARGON2_COST.parallelism}$`;

/** A hash with a different method or different costs is rebuilt after the login. */
export const needsNewHash = (gespeichert: string): boolean => !gespeichert.startsWith(ARGON2_PREFIX);

export function passwordFits(
  passwort: string | null | undefined,
  gespeichert: string,
  priority = false,
): Promise<boolean> {
  const p = String(passwort);
  return bcryptSchranke.mit(
    () => (gespeichert.startsWith('$argon2') ? verify(gespeichert, p) : bcryptPool.vergleiche(p, gespeichert)),
    priority,
  );
}

export function hashePassword(passwort: string | null | undefined): Promise<string> {
  return bcryptSchranke.mit(() => hash(String(passwort), ARGON2_COST));
}

/** Only at startup (first account, comparison value for unknown names), before requests come. */
export function hashePasswordImmediately(passwort: string): string {
  return hashSync(passwort, ARGON2_COST);
}
