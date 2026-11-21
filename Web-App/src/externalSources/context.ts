/** Settings for the keys, jobs for the Brickset resubmission. Separate from
 * area.ts so that a service knows its type without an import cycle. */
import { mit, type Kontext } from '../infra/area';
import type { Db } from '../../db/database';
import type { JobsServices } from '../jobQueue';
import type { SettingsServices } from '../settings';
import * as apiKontingent from './repository/apiQuota';
import * as apiTakt from './repository/apiTick';
import type { Quellen } from './sources';
import type { Uhr } from '../infra/clock';

export interface ForeignSourcesDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  /** What a test provides instead of the real clients; read at call time (area.ts). */
  ersatz?: Partial<Quellen> | undefined;
}

export const zugang = (db: Db) => ({
  apiKontingent: {
    countApiCall: mit(db)(apiKontingent.countApiCall),
    callsToday: mit(db)(apiKontingent.callsToday),
    callsJeAccount: mit(db)(apiKontingent.callsJeAccount),
    setApiCounterBack: mit(db)(apiKontingent.setApiCounterBack),
  },
  apiTakt: {
    receiptsTick: mit(db)(apiTakt.receiptsTick),
    pushTick: mit(db)(apiTakt.pushTick),
  },
});
export type ForeignSourcesContext = Kontext<ForeignSourcesDependencies, ReturnType<typeof zugang>>;
