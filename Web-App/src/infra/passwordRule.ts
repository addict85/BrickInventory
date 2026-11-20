import fs from 'node:fs';
import path from 'node:path';
import type { ErrorCode } from './errorTexts';
import { prozessweit } from './prozessweit';

/** One constant for all paths that set a password. Existing passwords
 * stay valid; the rule applies on the next set. */
export const PASSWORD_MIN_CHARS = 12;

export function passwordToShort(passwort: unknown): boolean {
  return String(passwort ?? '').length < PASSWORD_MIN_CHARS;
}

/** argon2id reads the whole password; the limit only keeps oversized inputs away
 * (the same as in the API contract, src/contract/account.ts). */
export const PASSWORD_MAX_CHARS = 1024;

/** Shipped along (haeufige-passwoerter.txt next to this file), without a network query. */
function haeufige(): Set<string> {
  return prozessweit(
    'haeufigePasswoerter',
    () =>
      new Set(
        fs
          .readFileSync(path.join(__dirname, 'haeufige-passwoerter.txt'), 'utf8')
          .split('\n')
          .map(z => z.trim())
          .filter(z => z && !z.startsWith('#')),
      ),
  );
}

/** For every path that sets a password: the reason for rejection or null. */
export function passwordLack(passwort: unknown, benutzername?: unknown): ErrorCode | null {
  if (passwordToShort(passwort)) return 'passwort_zu_kurz';
  const p = String(passwort);
  if (p.length > PASSWORD_MAX_CHARS) return 'passwort_zu_lang';
  const klein = p.toLowerCase();
  if (haeufige().has(klein) || (typeof benutzername === 'string' && klein === benutzername.toLowerCase()))
    return 'passwort_zu_haeufig';
  return null;
}
