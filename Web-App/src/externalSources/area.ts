/** From an access arise quota, throttles and the clients that receive exactly these:
 * two sets of services in one process share neither keys nor intermediate states. */
import { bound, buildContext, type Inspect } from '../infra/area';
import type { Db } from '../../db/database';
import * as brickset from './bricksetResubmission';
import * as apiQuotaService from './apiQuota';
import * as rateLimiter from './rateLimiter';
import { buildSources, type ClientsAccess, type Sources } from './sources';
import { access, type ForeignSourcesDependencies, type ForeignSourcesContext } from './context';

export type { ForeignSourcesDependencies, ForeignSourcesContext } from './context';

/** Read at call time, not at construction: a test replaces a client even after
 * the services already exist (test/helpers/sources.js testSources). */
function withFallback(real: Sources, spare: Partial<Sources> | undefined): Sources {
  if (!spare) return real;
  const from = {} as Sources;
  for (const n of Object.keys(real) as (keyof Sources)[])
    Object.defineProperty(from, n, { enumerable: true, get: () => (n in spare ? spare[n] : real[n]) });
  return from;
}

export function createForeignSources(a: ForeignSourcesDependencies, inspect?: Inspect<ForeignSourcesContext>) {
  const k: ForeignSourcesContext = buildContext(a, access);
  inspect?.(k);
  const throttle = rateLimiter.throttleRebrickable(k.apiTick, k.clock);
  const quota = {
    quotaStatus: bound(k)(apiQuotaService.quotaOverview),
    quotaFree: bound(k)(apiQuotaService.quotaFree),
    setQuotaBack: bound(k)(apiQuotaService.setQuotaBack),
    quotaLimit: bound(k)(apiQuotaService.limitTheSource),
  };
  const clients: ClientsAccess = {
    key: async name => (await k.settings.globalValue(name)) || '',
    count: api => apiQuotaService.checkAndCountQuota(k, api),
    quotaStatus: api => quota.quotaStatus(api),
    throttle,
    bricksetReserve: bound(k)(brickset.bricksetReserve),
    bricksetForgotten: bound(k)(brickset.bricksetForgotten),
  };
  const services = {
    /** The clients of this access; a test replaces individual ones via `spare`. */
    sources: withFallback(buildSources(clients), a.spare),
    throttle,
    quotaStatus: quota.quotaStatus,
    quotaFree: quota.quotaFree,
    setQuotaBack: quota.setQuotaBack,
    quotaLimit: quota.quotaLimit,
    consumeRebrickableDaily: bound(k)(rateLimiter.consumeRebrickableDaily),
    /** The resubmission of the sets for which Brickset had no quota left. */
    brickset: {
      dueFrom: bound(k)(brickset.bricksetDueFrom),
      now: bound(k)(brickset.bricksetNow),
      prefer: bound(k)(brickset.bricksetPrefer),
      numbers: bound(k)(brickset.bricksetNumbers),
      waiting: bound(k)(brickset.bricksetWaiting),
    },
  };
  // Clients call outside and never belong in a transaction: their set stays
  // the same so that throttles and quota are not created anew per transaction.
  return Object.assign(services, { over: (_db: Db) => services });
}

export type ForeignSourcesServices = ReturnType<typeof createForeignSources>;
