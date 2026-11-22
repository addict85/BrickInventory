/** argon2id: no limit of 72 bytes, and memory costs slow down graphics cards when guessing. Old bcrypt hashes
 * still apply until the next login replaces them (loginCheck.ts). */
import { hash, hashSync, verify } from '@node-rs/argon2';
import { bcryptPool, bcryptGate } from './bcryptLimit';

/** OWASP's default for argon2id (19 MiB, 2 passes); the library uses argon2id without a setting. */
export const ARGON2_COST = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const ARGON2_PREFIX = `$argon2id$v=19$m=${ARGON2_COST.memoryCost},t=${ARGON2_COST.timeCost},p=${ARGON2_COST.parallelism}$`;

/** A hash with a different method or different costs is rebuilt after the login. */
export const needsNewHash = (saved: string): boolean => !saved.startsWith(ARGON2_PREFIX);

export function passwordFits(password: string | null | undefined, saved: string, priority = false): Promise<boolean> {
  const p = String(password);
  return bcryptGate.run(
    () => (saved.startsWith('$argon2') ? verify(saved, p) : bcryptPool.compare(p, saved)),
    priority,
  );
}

export function hashPassword(password: string | null | undefined): Promise<string> {
  return bcryptGate.run(() => hash(String(password), ARGON2_COST));
}

/** Only at startup (first account, comparison value for unknown names), before requests come. */
export function hashPasswordImmediately(password: string): string {
  return hashSync(password, ARGON2_COST);
}
