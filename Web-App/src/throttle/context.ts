/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { withValue, type Context } from '../infra/area';
import type { Clock } from '../infra/clock';
import * as repository from './repository';

export interface ThrottleDependencies {
  db: Db;
  /** The in-memory fallback's clock. */
  uhr: Clock;
}

export const access = (db: Db) => ({
  counter: {
    read: withValue(db)(repository.read),
    increase: withValue(db)(repository.increase),
    lock: withValue(db)(repository.lock),
    occupySlot: withValue(db)(repository.occupySlot),
    freeSlot: withValue(db)(repository.freeSlot),
    deleteCounter: withValue(db)(repository.deleteCounter),
    deleteCountersWithPrefix: withValue(db)(repository.deleteCountersWithPrefix),
    deleteOldCounters: withValue(db)(repository.deleteOldCounters),
    countUp: withValue(db)(repository.countUp),
    hourlyState: withValue(db)(repository.hourlyState),
    countHour: withValue(db)(repository.countHour),
    countOncePerDay: withValue(db)(repository.countOncePerDay),
  },
});
export type ThrottleContext = Context<ThrottleDependencies, ReturnType<typeof access>>;
