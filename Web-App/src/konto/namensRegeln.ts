/** Was als Benutzername, Anmeldename und Gerätename taugt. */
import * as V from '../infra/validate';

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/** Ein Name ist Freitext, aber kein Träger für Adressen oder Zeilenumbrüche:
 * Er steht in Oberflächen und Exporten, wo ein Link wie vom Server aussähe. */
export function nameGueltig(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  const s = String(v);
  return s.length <= 100 && !/[\p{Cc}\u2028\u2029]/u.test(s) && !/:\/\/|www\.|https?:/i.test(s);
}

/** Geräte- und Passkey-Namen stehen wörtlich in den Hinweismails: Ohne Adressen und
 * Anführungszeichen fügt ein Eindringling dort keinen entwarnenden Satz mit Link an. */
export function geraeteNameGueltig(v: unknown): boolean {
  return nameGueltig(v) && geraeteNameInhaltGueltig(v);
}

/** Dieselbe Regel ohne Länge: Token-Labels der Anmeldung werden gekürzt statt abgewiesen. */
export function geraeteNameInhaltGueltig(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  return (
    !/[\p{Cc}\u2028\u2029]/u.test(v) &&
    !/:\/\/|www\.|https?:/i.test(v) &&
    !/["'`«»„“”‚‘’<>]/u.test(v) &&
    !/[\p{L}\d-]\.\p{L}{2,}(?![\p{L}\d])/u.test(v)
  );
}

export const EMAIL_RE = V.EMAIL_RE,
  emailGueltig: typeof V.emailGueltig = V.emailGueltig;

/** Name ODER E-Mail, weil die Anmeldung in beiden Spalten sucht. */
export function isValidLoginIdentifier(value: unknown): boolean {
  const v = String(value || '');
  return USERNAME_RE.test(v) || emailGueltig(v);
}
