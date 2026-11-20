/** Unknown bearer tokens cost database queries before apiDrossel knows an
 * account. Counting happens in rate_limit_attempts so that several web processes share the same
 * limit; writes only happen on a failed attempt, the lock itself is remembered by
 * each process so that a valid token costs no additional query.
 * Replaced tokens of a family do not count (reuse detection). */
import { drosselAdresse } from '../infra/throttleAddress';
import { countRequest } from './loginLimiter';
import { reportError } from '../infra/error';
import type { AccountContext } from './context';
import { prozessweit } from '../infra/prozessweit';

export const FAILED_ATTEMPT_WINDOW_MS = 60_000;
export const FAILED_ATTEMPT_MAX = 60;
const BUCKET = 'token-fehlversuch';

/** Address → end of the lock, only as a shortcut: the count is in the database. */
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

/** Only this process's shortcut; another process has its own. */
export function forgetLockInProcess(): void {
  gesperrt().clear();
}

export async function forgetFailedAttempts(k: AccountContext): Promise<void> {
  gesperrt().clear();
  await k.throttle
    .forgetCounter(BUCKET, { alsoBelow: true })
    .catch((e: unknown) => reportError('token-fehlversuch:vergessen', e));
}
