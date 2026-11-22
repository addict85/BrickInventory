/** Settings for the keys, jobs for the Brickset resubmission. Separate from
 * area.ts so that a service knows its type without an import cycle. */
import { withValue, type Context } from '../infra/area';
import type { Db } from '../../db/database';
import type { JobsServices } from '../jobQueue';
import type { SettingsServices } from '../settings';
import * as apiKontingent from './repository/apiQuota';
import * as apiTick from './repository/apiTick';
import type { Sources } from './sources';
import type { Clock } from '../infra/clock';

export interface ForeignSourcesDependencies {
  uhr: Clock;
  db: Db;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  /** What a test provides instead of the real clients; read at call time (area.ts). */
  ersatz?: Partial<Sources> | undefined;
}

export const access = (db: Db) => ({
  apiKontingent: {
    countApiCall: withValue(db)(apiKontingent.countApiCall),
    callsToday: withValue(db)(apiKontingent.callsToday),
    callsJeAccount: withValue(db)(apiKontingent.callsJeAccount),
    setApiCounterBack: withValue(db)(apiKontingent.setApiCounterBack),
  },
  apiTakt: {
    receiptsTick: withValue(db)(apiTick.receiptsTick),
    pushTick: withValue(db)(apiTick.pushTick),
  },
});
export type ForeignSourcesContext = Context<ForeignSourcesDependencies, ReturnType<typeof access>>;
