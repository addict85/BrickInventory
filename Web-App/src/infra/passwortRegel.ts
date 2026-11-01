import fs from 'node:fs';
import path from 'node:path';
import type { FehlerCode } from './fehlerTexte';

/** Eine Konstante für alle Wege, die ein Passwort setzen. */
export const PASSWORT_MIN_ZEICHEN = 8;

export function passwortZuKurz(passwort: unknown): boolean {
  return String(passwort ?? '').length < PASSWORT_MIN_ZEICHEN;
}

/** bcrypt liest nur die ersten 72 Byte: Was dahinter steht, prüfte nie jemand,
 * und zwei Passwörter mit gleichem Anfang wären gleich. */
export const PASSWORT_MAX_BYTE = 72;

let liste: Set<string> | null = null;
/** Mitgeliefert (haeufige-passwoerter.txt neben dieser Datei), ohne Netzabfrage. */
function haeufige(): Set<string> {
  return liste ??= new Set(fs.readFileSync(path.join(__dirname, 'haeufige-passwoerter.txt'), 'utf8')
    .split('\n').map(z => z.trim()).filter(z => z && !z.startsWith('#')));
}

/** Für jeden Weg, der ein Passwort setzt: der Grund der Ablehnung oder null. */
export function passwortMangel(passwort: unknown, benutzername?: unknown): FehlerCode | null {
  if (passwortZuKurz(passwort)) return 'passwort_zu_kurz';
  const p = String(passwort);
  if (Buffer.byteLength(p, 'utf8') > PASSWORT_MAX_BYTE) return 'passwort_zu_lang';
  const klein = p.toLowerCase();
  if (haeufige().has(klein) || (typeof benutzername === 'string' && klein === benutzername.toLowerCase()))
    return 'passwort_zu_haeufig';
  return null;
}
