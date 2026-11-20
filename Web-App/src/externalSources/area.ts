/** From an access arise quota, throttles and the clients that receive exactly these:
 * two sets of services in one process share neither keys nor intermediate states. */
import { mit, buildContext, type Inspect } from '../infra/area';
import type { Db } from '../../db/database';
import * as brickset from './bricksetResubmission';
import * as apiQuotaService from './apiQuota';
import * as rateLimiter from './rateLimiter';
import { buildSources, type ClientsAccess, type Quellen } from './sources';
import { zugang, type ForeignSourcesDependencies, type ForeignSourcesContext } from './context';

export type { ForeignSourcesDependencies, ForeignSourcesContext } from './context';

/** Read at call time, not at construction: a test replaces a client even after
 * the services already exist (test/helpers/sources.js testSources). */
function withFallback(echt: Quellen, ersatz: Partial<Quellen> | undefined): Quellen {
  if (!ersatz) return echt;
  const aus = {} as Quellen;
  for (const n of Object.keys(echt) as (keyof Quellen)[])
    Object.defineProperty(aus, n, { enumerable: true, get: () => (n in ersatz ? ersatz[n] : echt[n]) });
  return aus;
}

export function createForeignSources(a: ForeignSourcesDependencies, inspect?: Inspect<ForeignSourcesContext>) {
  const k: ForeignSourcesContext = buildContext(a, zugang);
  inspect?.(k);
  const drossel = rateLimiter.throttleRebrickable(k.apiTakt, k.uhr);
  const kontingent = {
    quotaStatus: mit(k)(apiQuotaService.kontingentUebersicht),
    quotaFree: mit(k)(apiQuotaService.quotaFree),
    setQuotaBack: mit(k)(apiQuotaService.setQuotaBack),
    quotaLimit: mit(k)(apiQuotaService.limitTheSource),
  };
  const clients: ClientsAccess = {
    schluessel: async name => (await k.einstellungen.globalValue(name)) || '',
    zaehle: api => apiQuotaService.kontingentPruefenUndZaehlen(k, api),
    quotaStatus: api => kontingent.quotaStatus(api),
    drossel,
    bricksetReserve: mit(k)(brickset.bricksetReserve),
    bricksetForgotten: mit(k)(brickset.bricksetForgotten),
  };
  const dienste = {
    /** The clients of this access; a test replaces individual ones via `ersatz`. */
    quellen: withFallback(buildSources(clients), a.ersatz),
    drossel,
    quotaStatus: kontingent.quotaStatus,
    quotaFree: kontingent.quotaFree,
    setQuotaBack: kontingent.setQuotaBack,
    quotaLimit: kontingent.quotaLimit,
    consumeRebrickableDaily: mit(k)(rateLimiter.consumeRebrickableDaily),
    /** The resubmission of the sets for which Brickset had no quota left. */
    brickset: {
      dueAb: mit(k)(brickset.bricksetDueAb),
      jetzt: mit(k)(brickset.bricksetNow),
      prefer: mit(k)(brickset.bricksetPrefer),
      zahlen: mit(k)(brickset.bricksetNumbers),
      wartende: mit(k)(brickset.bricksetWaiting),
    },
  };
  // Clients call outside and never belong in a transaction: their set stays
  // the same so that throttles and quota are not created anew per transaction.
  return Object.assign(dienste, { ueber: (_db: Db) => dienste });
}

export type ForeignSourcesServices = ReturnType<typeof createForeignSources>;
