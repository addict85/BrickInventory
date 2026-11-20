import type { DbInterface } from '../../db/database';
import { currentAccount } from '../infra/accountContext';
import * as repo from './repository/apiQuota';
import type { ForeignSourcesContext } from './context';

export type ApiName = 'bricklink' | 'rebrickable' | 'brickset';

export const REBRICKABLE_DEFAULT_DAILY = 25000;
const DEFAULTS: Record<ApiName, number> = { bricklink: 4000, rebrickable: REBRICKABLE_DEFAULT_DAILY, brickset: 100 };

/** Je Konto (ausser Verwaltern): Sonst verbrauchte ein Unterkonto das
 * Kontingent aller. */
export const SHARE_JE_ACCOUNT = 0.25;

/** Alle Nicht-Verwalter zusammen; die andere Hälfte bleibt Verwaltern und dem
 * Hintergrund. Gezählt in der Zeile `konto = -1`. */
export const SHARE_ALL_ACCOUNTS = 0.5;
const ALL_ACCOUNTS = -1;

const heute = (k: ForeignSourcesContext) => k.uhr.datum().toISOString().slice(0, 10);

export async function limitTheSource(k: ForeignSourcesContext, apiName: ApiName): Promise<number> {
  return parseInt(await k.einstellungen.globalValue(`api_limit_${apiName}`, ''), 10) || DEFAULTS[apiName] || 4000;
}

const limitJeAccount = (limit: number) => Math.max(1, Math.ceil(limit * SHARE_JE_ACCOUNT));
const limitAllAccounts = (limit: number) => Math.max(1, Math.ceil(limit * SHARE_ALL_ACCOUNTS));

/** Atomar: Das Upsert erhöht nur unter der Grenze, und scheitert die Grenze des
 * Kontos, fällt auch die Gesamtzählung zurück. */
export async function kontingentPruefenUndZaehlen(k: ForeignSourcesContext, apiName: ApiName, _default?: number) {
  const limit = await limitTheSource(k, apiName);
  const tag = heute(k);
  const konto = currentAccount();
  const zaehle = async (tx: DbInterface, id: number, grenze: number): Promise<number | null> => {
    const z = await repo.countApiCall(tx, tag, apiName, id, grenze);
    return z ? Number(z.count) : null;
  };
  if (limit <= 0) return { allowed: false, count: 0, limit, remaining: 0 };
  return k
    .transaktion(async t => {
      const gesamt = await zaehle(t.db, 0, limit);
      if (gesamt === null) return { allowed: false, count: limit, limit, remaining: 0 };
      if (konto && !konto.verwalter) {
        const alle = await zaehle(t.db, ALL_ACCOUNTS, limitAllAccounts(limit));
        const eigen = alle === null ? null : await zaehle(t.db, konto.id, limitJeAccount(limit));
        if (eigen === null) throw Object.assign(new Error('kontingent_je_konto'), { accountFull: true });
      }
      return { allowed: true, count: gesamt, limit, remaining: limit - gesamt };
    })
    .catch((e: { accountFull?: boolean }) => {
      if (e?.accountFull) return { allowed: false, count: 0, limit, remaining: 0, jeAccount: true };
      throw e;
    });
}

export async function kontingentUebersicht(k: ForeignSourcesContext, apiName: ApiName) {
  const tag = heute(k);
  const [z, limit] = await Promise.all([k.apiKontingent.callsToday(tag, apiName), limitTheSource(k, apiName)]);
  const count = Number(z?.count || 0);
  return { count, limit, remaining: Math.max(0, limit - count), date: tag };
}

/** Zählt NICHT: Die Aufrufer fragen vorher, damit ein erschöpftes Kontingent
 * als solches gemeldet wird statt als Abruffehler. */
export async function quotaFree(kx: ForeignSourcesContext, apiName: ApiName) {
  const s = await kontingentUebersicht(kx, apiName);
  const konto = currentAccount();
  if (!konto || konto.verwalter || s.remaining <= 0) return { allowed: s.remaining > 0, limit: s.limit };
  const z = await kx.apiKontingent.callsJeAccount(s.date, apiName, konto.id, ALL_ACCOUNTS);
  const stand = (k: number) => Number(z.find(r => Number(r.account_id) === k)?.count || 0);
  return {
    allowed: stand(konto.id) < limitJeAccount(s.limit) && stand(ALL_ACCOUNTS) < limitAllAccounts(s.limit),
    limit: s.limit,
  };
}

export async function setQuotaBack(k: ForeignSourcesContext, apiName: ApiName): Promise<void> {
  await k.apiKontingent.setApiCounterBack(heute(k), apiName);
}
