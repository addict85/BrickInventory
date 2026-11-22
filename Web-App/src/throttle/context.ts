/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { bound, type Context } from '../infra/area';
import type { Clock } from '../infra/clock';
import * as repository from './repository';

export interface ThrottleDependencies {
  db: Db;
  /** The in-memory fallback's clock. */
  clock: Clock;
}

export const access = (db: Db) => ({
  counter: {
    read: bound(db)(repository.read),
    increase: bound(db)(repository.increase),
    lock: bound(db)(repository.lock),
    occupySlot: bound(db)(repository.occupySlot),
    freeSlot: bound(db)(repository.freeSlot),
    deleteCounter: bound(db)(repository.deleteCounter),
    deleteCountersWithPrefix: bound(db)(repository.deleteCountersWithPrefix),
    deleteOldCounters: bound(db)(repository.deleteOldCounters),
    countUp: bound(db)(repository.countUp),
    hourlyState: bound(db)(repository.hourlyState),
    countHour: bound(db)(repository.countHour),
    countOncePerDay: bound(db)(repository.countOncePerDay),
  },
  apiBudget: {
    claim: bound(db)(repository.claimApiBudget),
    clear: bound(db)(repository.clearApiBudget),
  },
});
export type ThrottleContext = Context<ThrottleDependencies, ReturnType<typeof access>>;
