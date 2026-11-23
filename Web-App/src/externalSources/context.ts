/** Settings for the keys, jobs for the Brickset resubmission. Separate from
 * area.ts so that a service knows its type without an import cycle. */
import { bound, type Context } from '../infra/area';
import type { Db } from '../../db/database';
import type { JobsServices } from '../jobQueue';
import type { SettingsServices } from '../settings';
import * as apiQuota from './repository/apiQuota';
import * as apiTick from './repository/apiTick';
import type { Sources } from './sources';
import type { Clock } from '../infra/clock';

export interface ForeignSourcesDependencies {
  clock: Clock;
  db: Db;
  settings: SettingsServices;
  jobQueue: JobsServices;
  /** What a test provides instead of the real clients; read at call time (area.ts). */
  spare?: Partial<Sources> | undefined;
}

export const access = (db: Db) => ({
  apiQuota: {
    countApiCall: bound(db)(apiQuota.countApiCall),
    callsToday: bound(db)(apiQuota.callsToday),
    callsPerAccount: bound(db)(apiQuota.callsPerAccount),
    setApiCounterBack: bound(db)(apiQuota.setApiCounterBack),
  },
  apiTick: {
    receiptsTick: bound(db)(apiTick.receiptsTick),
    pushTick: bound(db)(apiTick.pushTick),
  },
});
export type ForeignSourcesContext = Context<ForeignSourcesDependencies, ReturnType<typeof access>>;
