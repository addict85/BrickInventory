/** Unknown bearer tokens cost database queries before apiThrottle knows an
 * account. Counting happens in rate_limit_attempts so that several web processes share the same
 * limit; writes only happen on a failed attempt, the lock itself is remembered by
 * each process so that a valid token costs no additional query.
 * Replaced tokens of a family do not count (reuse detection). */
import { throttleAddress } from '../infra/throttleAddress';
import { countRequest } from './loginLimiter';
import { reportError } from '../infra/error';
import type { AccountContext } from './context';
import { processWide } from '../infra/processWide';

export const FAILED_ATTEMPT_WINDOW_MS = 60_000;
export const FAILED_ATTEMPT_MAX = 60;
const BUCKET = 'token-fehlversuch';

/** Address → end of the lock, only as a shortcut: the count is in the database. */
const locked = () => processWide('tokenLock', () => new Map<string, number>());

export async function countFailedAttempt(
  kx: AccountContext,
  ip: string | null | undefined,
  now = Date.now(),
): Promise<void> {
  if (!ip) return;
  const st = await countRequest(kx, BUCKET, ip, FAILED_ATTEMPT_WINDOW_MS);
  if (st.count <= FAILED_ATTEMPT_MAX) return;
  const lockedUntil = locked();
  lockedUntil.set(throttleAddress(ip), now + Math.min(st.waitMin * 60_000, FAILED_ATTEMPT_WINDOW_MS));
  if (lockedUntil.size > 5000) for (const [k, bis] of lockedUntil) if (bis <= now) lockedUntil.delete(k);
}

export function toManyFailedAttempts(ip: string | null | undefined, now = Date.now()): boolean {
  if (!ip) return false;
  const bis = locked().get(throttleAddress(ip));
  return bis !== undefined && now < bis;
}

/** Only this process's shortcut; another process has its own. */
export function forgetLockInProcess(): void {
  locked().clear();
}

export async function forgetFailedAttempts(k: AccountContext): Promise<void> {
  locked().clear();
  await k.throttle
    .forgetCounter(BUCKET, { alsoBelow: true })
    .catch((e: unknown) => reportError('token-fehlversuch:vergessen', e));
}
