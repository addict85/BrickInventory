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
  grund: 'konto' | 'abstand' | 'botschutz';
  wartenSek: number;
}

export type Lookup = { art: 'guthaben'; guthaben: Balance } | ({ art: 'gesperrt' } & Locked);

/** In the database, so the limit holds across every process. */
export async function claimSlot(k: VoucherContext, uid: number): Promise<{ frei: true } | ({ frei: false } & Locked)> {
  return k.transact(async t => {
    // In case an older backup lacks the row. NULL means "never" — a date would be a claim.
    await repo.ensureThrottleRow(t.db);

    // In SQL: ONE row, ONE lock, ONE clock.
    const z = (await repo.throttleState(t.db, GAP_SEC)) as { sperre_sek?: unknown; abstand_sek?: unknown } | undefined;

    // NULL (= never) comes back as NaN and means "no remainder".
    const rest = (w: unknown) => {
      const n = Number(w);
      return Number.isFinite(n) ? n : 0;
    };

    const account = await t.throttle.hourlyState(accountKey(uid));
    if (rest(account?.anzahl) >= ACCOUNT_PER_HOUR)
      return { frei: false as const, grund: 'konto' as const, wartenSek: Math.max(1, rest(account?.warten_sek)) };

    // The lock first: whoever reports it should not hear "12 more seconds"
    // when it is 20 minutes.
    const lock = rest(z?.sperre_sek);
    if (lock > 0) return { frei: false as const, grund: 'botschutz' as const, wartenSek: lock };

    const gap = rest(z?.abstand_sek);
    if (gap > 0) return { frei: false as const, grund: 'abstand' as const, wartenSek: gap };

    await repo.rememberCall(t.db);
    await t.throttle.countHour(accountKey(uid));
    return { frei: true as const };
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
  if (!slot.frei) {
    return { art: 'gesperrt', grund: slot.grund, wartenSek: slot.wartenSek };
  }
  try {
    // Set individually: exactOptionalPropertyTypes distinguishes "not set" from
    // "undefined", and only "not set" makes fetchBalance use the real fetch.
    const through = { locale: opt.locale || DEFAULT_COUNTRY, fetch: opt.fetch ?? k.externalSources.quellen.legoFetch };
    const store = k.faecher.slot<SessionStore>('voucherBalanceSessions', () => new Map());
    const guthaben = await fetchBalance(store, number, pin, through);
    return { art: 'guthaben', guthaben };
  } catch (e) {
    if (e instanceof BotProtection) {
      const wartenSek = await lockForBotProtection(k);
      console.warn(
        `[guthaben] bot protection — ${BOT_PROTECTION_PAUSE_MIN} minutes pause: ${e.message}`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      return { art: 'gesperrt', grund: 'botschutz', wartenSek };
    }
    // An error from the other side is not a server error: whoever asked should read the reason.
    const grund = redact(String((e as Error)?.message || e), number, pin);
    console.warn(`[guthaben] lookup failed: ${grund}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    throw new DomainError('fremddienst', 'guthaben_fehlgeschlagen', { grund });
  }
}
