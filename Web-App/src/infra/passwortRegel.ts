import fs from 'node:fs';
import path from 'node:path';
import type { ErrorCode } from './fehlerTexte';
import { prozessweit } from './prozessweit';

/** Eine Konstante für alle Wege, die ein Passwort setzen. Bestehende Passwörter
 * gelten weiter; die Regel greift beim nächsten Setzen. */
export const PASSWORD_MIN_CHARS = 12;

export function passwordToShort(passwort: unknown): boolean {
  return String(passwort ?? '').length < PASSWORD_MIN_CHARS;
}

/** argon2id liest das ganze Passwort; die Grenze hält nur übergrosse Eingaben fern
 * (dieselbe wie im API-Vertrag, src/vertrag/konto.ts). */
export const PASSWORD_MAX_CHARS = 1024;

/** Mitgeliefert (haeufige-passwoerter.txt neben dieser Datei), ohne Netzabfrage. */
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

/** Für jeden Weg, der ein Passwort setzt: der Grund der Ablehnung oder null. */
export function passwordLack(passwort: unknown, benutzername?: unknown): ErrorCode | null {
  if (passwordToShort(passwort)) return 'passwort_zu_kurz';
  const p = String(passwort);
  if (p.length > PASSWORD_MAX_CHARS) return 'passwort_zu_lang';
  const klein = p.toLowerCase();
  if (haeufige().has(klein) || (typeof benutzername === 'string' && klein === benutzername.toLowerCase()))
    return 'passwort_zu_haeufig';
  return null;
}
