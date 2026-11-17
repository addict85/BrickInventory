/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import type { Uhr } from '../infra/uhr';
import * as repository from './repository';

export interface ThrottleDependencies {
  db: Db;
  /** The in-memory fallback's clock. */
  uhr: Uhr;
}

export const access = (db: Db) => ({
  counter: {
    read: mit(db)(repository.read),
    increase: mit(db)(repository.increase),
    lock: mit(db)(repository.lock),
    occupySlot: mit(db)(repository.occupySlot),
    freeSlot: mit(db)(repository.freeSlot),
    deleteCounter: mit(db)(repository.deleteCounter),
    deleteCountersWithPrefix: mit(db)(repository.deleteCountersWithPrefix),
    deleteOldCounters: mit(db)(repository.deleteOldCounters),
    countUp: mit(db)(repository.countUp),
    hourlyState: mit(db)(repository.hourlyState),
    countHour: mit(db)(repository.countHour),
    countOncePerDay: mit(db)(repository.countOncePerDay),
  },
});
export type ThrottleContext = Kontext<ThrottleDependencies, ReturnType<typeof access>>;
