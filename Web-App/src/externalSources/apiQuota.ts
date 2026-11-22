import type { DbInterface } from '../../db/database';
import { currentAccount } from '../infra/accountContext';
import * as repo from './repository/apiQuota';
import type { ForeignSourcesContext } from './context';

export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';

export const REBRICKABLE_DEFAULT_DAILY = 25000;
const DEFAULTS: Record<ApiName, number> = { bricklink: 4000, rebrickable: REBRICKABLE_DEFAULT_DAILY, brickset: 100 };

/** Per account (except admins): otherwise a sub-account would use up
 * everyone's quota. */
export const SHARE_JE_ACCOUNT = 0.25;

/** All non-admins together; the other half stays with the admins and the
 * background. Counted in the row `account = -1`. */
export const SHARE_ALL_ACCOUNTS = 0.5;
const ALL_ACCOUNTS = -1;

const today = (k: ForeignSourcesContext) => k.clock.datum().toISOString().slice(0, 10);

export async function limitTheSource(k: ForeignSourcesContext, apiName: ApiName): Promise<number> {
  return parseInt(await k.settings.globalValue(`api_limit_${apiName}`, ''), 10) || DEFAULTS[apiName] || 4000;
}

const limitJeAccount = (limit: number) => Math.max(1, Math.ceil(limit * SHARE_JE_ACCOUNT));
const limitAllAccounts = (limit: number) => Math.max(1, Math.ceil(limit * SHARE_ALL_ACCOUNTS));

/** Atomic: the upsert only increments below the limit, and if the account's limit
 * fails, the total count falls back as well. */
export async function checkAndCountQuota(k: ForeignSourcesContext, apiName: ApiName, _default?: number) {
  const limit = await limitTheSource(k, apiName);
  const tag = today(k);
  const account = currentAccount();
  const count = async (tx: DbInterface, id: number, limit: number): Promise<number | null> => {
    const z = await repo.countApiCall(tx, tag, apiName, id, limit);
    return z ? Number(z.count) : null;
  };
  if (limit <= 0) return { allowed: false, count: 0, limit, remaining: 0 };
  return k
    .transact(async t => {
      const total = await count(t.db, 0, limit);
      if (total === null) return { allowed: false, count: limit, limit, remaining: 0 };
      if (account && !account.admin) {
        const all = await count(t.db, ALL_ACCOUNTS, limitAllAccounts(limit));
        const own = all === null ? null : await count(t.db, account.id, limitJeAccount(limit));
        if (own === null) throw Object.assign(new Error('kontingent_je_konto'), { accountFull: true });
      }
      return { allowed: true, count: total, limit, remaining: limit - total };
    })
    .catch((e: { accountFull?: boolean }) => {
      if (e?.accountFull) return { allowed: false, count: 0, limit, remaining: 0, jeAccount: true };
      throw e;
    });
}

export async function quotaOverview(k: ForeignSourcesContext, apiName: ApiName) {
  const tag = today(k);
  const [z, limit] = await Promise.all([k.apiQuota.callsToday(tag, apiName), limitTheSource(k, apiName)]);
  const count = Number(z?.count || 0);
  return { count, limit, remaining: Math.max(0, limit - count), date: tag };
}

/** Does NOT count: the callers ask beforehand so that an exhausted quota
 * is reported as such instead of as a fetch error. */
export async function quotaFree(kx: ForeignSourcesContext, apiName: ApiName) {
  const s = await quotaOverview(kx, apiName);
  const account = currentAccount();
  if (!account || account.admin || s.remaining <= 0) return { allowed: s.remaining > 0, limit: s.limit };
  const z = await kx.apiQuota.callsJeAccount(s.date, apiName, account.id, ALL_ACCOUNTS);
  const state = (k: number) => Number(z.find(r => Number(r.account_id) === k)?.count || 0);
  return {
    allowed: state(account.id) < limitJeAccount(s.limit) && state(ALL_ACCOUNTS) < limitAllAccounts(s.limit),
    limit: s.limit,
  };
}

export async function setQuotaBack(k: ForeignSourcesContext, apiName: ApiName): Promise<void> {
  await k.apiQuota.setApiCounterBack(today(k), apiName);
}
