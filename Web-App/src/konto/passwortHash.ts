/** argon2id: keine Grenze von 72 Byte, und Speicherkosten bremsen Grafikkarten beim Raten. Alte bcrypt-Hashes
 * gelten weiter, bis die nächste Anmeldung sie ersetzt (anmeldepruefung.ts). */
import { hash, hashSync, verify } from '@node-rs/argon2';
import { bcryptPool, bcryptSchranke } from './bcryptSchranke';

/** Die Vorgabe von OWASP für argon2id (19 MiB, 2 Durchläufe); die Bibliothek nimmt argon2id ohne Angabe. */
export const ARGON2_KOSTEN = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const ARGON2_PRAEFIX = `$argon2id$v=19$m=${ARGON2_KOSTEN.memoryCost},t=${ARGON2_KOSTEN.timeCost},p=${ARGON2_KOSTEN.parallelism}$`;

/** Ein Hash mit anderem Verfahren oder anderen Kosten wird nach der Anmeldung neu gebildet. */
export const brauchtNeuenHash = (gespeichert: string): boolean => !gespeichert.startsWith(ARGON2_PRAEFIX);

export function passwortPasst(
  passwort: string | null | undefined,
  gespeichert: string,
  vorrang = false,
): Promise<boolean> {
  const p = String(passwort);
  return bcryptSchranke.mit(
    () => (gespeichert.startsWith('$argon2') ? verify(gespeichert, p) : bcryptPool.vergleiche(p, gespeichert)),
    vorrang,
  );
}

export function hashePasswort(passwort: string | null | undefined): Promise<string> {
  return bcryptSchranke.mit(() => hash(String(passwort), ARGON2_KOSTEN));
}

/** Nur beim Start (erstes Konto, Vergleichswert für unbekannte Namen), bevor Anfragen kommen. */
export function hashePasswortSofort(passwort: string): string {
  return hashSync(passwort, ARGON2_KOSTEN);
}
