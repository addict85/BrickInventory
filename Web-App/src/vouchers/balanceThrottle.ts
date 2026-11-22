/** One call every 30 seconds across all accounts, and quiet when bot protection
 * kicks in — otherwise LEGO blocks the address. */
import {
  fetchBalance,
  BotProtection,
  DEFAULT_COUNTRY,
  redact,
  type FetchFn,
  type Balance,
  type SessionStore,
} from './balanceLookup';
import { DomainError } from '../infra/errorTexts';
import * as repo from './repository/balanceThrottle';
import type { VoucherContext } from './context';

export const GAP_SEC = 30;

export const BOT_PROTECTION_PAUSE_MIN = 30;

/** Ahead of the shared limit: one account alone does not permanently occupy the
 * 30s slot, nor trigger bot protection for everyone arbitrarily often. */
export const ACCOUNT_PER_HOUR = 20;
const accountKey = (uid: number) => `guthaben-konto|${uid}`;

export interface Locked {
  reason: 'konto' | 'abstand' | 'botschutz';
  waitSeconds: number;
}

export type Lookup = { kind: 'guthaben'; balance: Balance } | ({ kind: 'gesperrt' } & Locked);

/** In the database, so the limit holds across every process. */
export async function claimSlot(k: VoucherContext, uid: number): Promise<{ free: true } | ({ free: false } & Locked)> {
  return k.transact(async t => {
    // In case an older backup lacks the row. NULL means "never" — a date would be a claim.
    await repo.ensureThrottleRow(t.db);

    // In SQL: ONE row, ONE lock, ONE clock.
    const z = (await repo.throttleState(t.db, GAP_SEC)) as { sperre_sek?: unknown; gap_sec?: unknown } | undefined;

    // NULL (= never) comes back as NaN and means "no remainder".
    const rest = (w: unknown) => {
      const n = Number(w);
      return Number.isFinite(n) ? n : 0;
    };

    const account = await t.throttle.hourlyState(accountKey(uid));
    if (rest(account?.count) >= ACCOUNT_PER_HOUR)
      return { free: false as const, reason: 'konto' as const, waitSeconds: Math.max(1, rest(account?.wait_sec)) };

    // The lock first: whoever reports it should not hear "12 more seconds"
    // when it is 20 minutes.
    const lock = rest(z?.sperre_sek);
    if (lock > 0) return { free: false as const, reason: 'botschutz' as const, waitSeconds: lock };

    const gap = rest(z?.gap_sec);
    if (gap > 0) return { free: false as const, reason: 'abstand' as const, waitSeconds: gap };

    await repo.rememberCall(t.db);
    await t.throttle.countHour(accountKey(uid));
    return { free: true as const };
  });
}

/** @returns the pause in seconds, as reported to the frontend */
export async function lockForBotProtection(k: VoucherContext): Promise<number> {
  await k.balanceThrottle.lockThrottle(BOT_PROTECTION_PAUSE_MIN);
  return BOT_PROTECTION_PAUSE_MIN * 60;
}

export async function forgetThrottle(k: VoucherContext): Promise<void> {
  await k.balanceThrottle.openThrottle();
}

// The only way to the lookup, so nobody bypasses the throttle.
export async function checkBalanceThrottled(
  k: VoucherContext,
  uid: number,
  number: string,
  pin: string,
  opt: { locale?: string; fetch?: FetchFn } = {},
): Promise<Lookup> {
  const slot = await claimSlot(k, uid);
  if (!slot.free) {
    return { kind: 'gesperrt', reason: slot.reason, waitSeconds: slot.waitSeconds };
  }
  try {
    // Set individually: exactOptionalPropertyTypes distinguishes "not set" from
    // "undefined", and only "not set" makes fetchBalance use the real fetch.
    const through = { locale: opt.locale || DEFAULT_COUNTRY, fetch: opt.fetch ?? k.externalSources.sources.legoFetch };
    const store = k.compartments.slot<SessionStore>('voucherBalanceSessions', () => new Map());
    const balance = await fetchBalance(store, number, pin, through);
    return { kind: 'guthaben', balance };
  } catch (e) {
    if (e instanceof BotProtection) {
      const waitSeconds = await lockForBotProtection(k);
      console.warn(`[guthaben] bot protection — ${BOT_PROTECTION_PAUSE_MIN} minutes pause: ${e.message}`);
      return { kind: 'gesperrt', reason: 'botschutz', waitSeconds };
    }
    // An error from the other side is not a server error: whoever asked should read the reason.
    const reason = redact(String((e as Error)?.message || e), number, pin);
    console.warn(`[guthaben] lookup failed: ${reason}`);
    throw new DomainError('upstream', 'balance_failed', { reason });
  }
}
