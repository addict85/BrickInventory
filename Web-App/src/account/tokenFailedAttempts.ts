/** Unbekannte Bearer-Token kosten Datenbankabfragen, bevor apiDrossel ein Konto
 * kennt. Gezählt wird in rate_limit_attempts, damit mehrere Web-Prozesse dieselbe
 * Grenze teilen; geschrieben wird nur beim Fehlversuch, die Sperre selbst merkt sich
 * jeder Prozess, damit ein gültiger Token keine zusätzliche Abfrage kostet.
 * Ersetzte Token einer Familie zählen nicht mit (Wiederverwendungserkennung). */
import { drosselAdresse } from '../infra/drosselAdresse';
import { countRequest } from './loginLimiter';
import { reportError } from '../infra/fehler';
import type { AccountContext } from './context';
import { prozessweit } from '../infra/prozessweit';

export const FAILED_ATTEMPT_WINDOW_MS = 60_000;
export const FAILED_ATTEMPT_MAX = 60;
const BUCKET = 'token-fehlversuch';

/** Adresse → Ende der Sperre, nur als Abkürzung: Die Zählung steht in der Datenbank. */
const gesperrt = () => prozessweit('tokenSperre', () => new Map<string, number>());

export async function countFailedAttempt(
  kx: AccountContext,
  ip: string | null | undefined,
  jetzt = Date.now(),
): Promise<void> {
  if (!ip) return;
  const st = await countRequest(kx, BUCKET, ip, FAILED_ATTEMPT_WINDOW_MS);
  if (st.count <= FAILED_ATTEMPT_MAX) return;
  const lockedUntil = gesperrt();
  lockedUntil.set(drosselAdresse(ip), jetzt + Math.min(st.waitMin * 60_000, FAILED_ATTEMPT_WINDOW_MS));
  if (lockedUntil.size > 5000) for (const [k, bis] of lockedUntil) if (bis <= jetzt) lockedUntil.delete(k);
}

export function toManyFailedAttempts(ip: string | null | undefined, jetzt = Date.now()): boolean {
  if (!ip) return false;
  const bis = gesperrt().get(drosselAdresse(ip));
  return bis !== undefined && jetzt < bis;
}

/** Nur die Abkürzung dieses Prozesses; ein anderer Prozess hat seine eigene. */
export function forgetLockInProcess(): void {
  gesperrt().clear();
}

export async function forgetFailedAttempts(k: AccountContext): Promise<void> {
  gesperrt().clear();
  await k.throttle
    .forgetCounter(BUCKET, { alsoBelow: true })
    .catch((e: unknown) => reportError('token-fehlversuch:vergessen', e));
}
