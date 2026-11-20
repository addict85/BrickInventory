/** Aus einem Zugang entstehen Kontingent, Drosseln und die Klienten, die genau diese bekommen:
 * Zwei Sätze Dienste in einem Prozess teilen weder Schlüssel noch Zwischenstände. */
import { mit, buildContext, type Inspect } from '../infra/bereich';
import type { Db } from '../../db/database';
import * as brickset from './bricksetResubmission';
import * as apiQuotaService from './apiQuota';
import * as rateLimiter from './rateLimiter';
import { buildSources, type ClientsAccess, type Quellen } from './sources';
import { zugang, type ForeignSourcesDependencies, type ForeignSourcesContext } from './context';

export type { ForeignSourcesDependencies, ForeignSourcesContext } from './context';

/** Gelesen beim Aufruf, nicht beim Bau: Ein Test ersetzt einen Klienten auch, nachdem
 * die Dienste schon stehen (test/helpers/sources.js testSources). */
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
    /** Die Klienten dieses Zugangs; ein Test ersetzt einzelne über `ersatz`. */
    quellen: withFallback(buildSources(clients), a.ersatz),
    drossel,
    quotaStatus: kontingent.quotaStatus,
    quotaFree: kontingent.quotaFree,
    setQuotaBack: kontingent.setQuotaBack,
    quotaLimit: kontingent.quotaLimit,
    consumeRebrickableDaily: mit(k)(rateLimiter.consumeRebrickableDaily),
    /** Die Wiedervorlage der Sets, für die Brickset kein Kontingent mehr hatte. */
    brickset: {
      dueAb: mit(k)(brickset.bricksetDueAb),
      jetzt: mit(k)(brickset.bricksetNow),
      prefer: mit(k)(brickset.bricksetPrefer),
      zahlen: mit(k)(brickset.bricksetNumbers),
      wartende: mit(k)(brickset.bricksetWaiting),
    },
  };
  // Klienten rufen nach draussen und gehören nie in eine Transaktion: Ihr Satz bleibt
  // derselbe, damit Drosseln und Kontingent nicht je Transaktion neu entstehen.
  return Object.assign(dienste, { ueber: (_db: Db) => dienste });
}

export type ForeignSourcesServices = ReturnType<typeof createForeignSources>;
