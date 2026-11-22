/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { buildArea, mit, type Inspect } from '../infra/area';
import * as counter from './counter';
import { access, type ThrottleDependencies, type ThrottleContext } from './context';

export type { ThrottleDependencies, ThrottleContext } from './context';

/** Login attempts, balance lookups and source fetches all count in one table; only this area may write. */
export function createThrottle(a: ThrottleDependencies, inspect?: Inspect<ThrottleContext>) {
  return buildArea(
    a,
    access,
    (k: ThrottleContext) => ({
      counterState: mit(k)(counter.counterState),
      countAttempt: mit(k)(counter.countAttempt),
      reserve: mit(k)(counter.reserve),
      releaseSlot: mit(k)(counter.releaseSlot),
      forgetCounter: mit(k)(counter.forgetCounter),
      countInWindow: mit(k)(counter.countInWindow),
      cleanUp: mit(k)(counter.cleanUp),
      oncePerDay: mit(k)(counter.oncePerDay),
      hourlyState: k.counter.hourlyState,
      countHour: k.counter.countHour,
    }),
    inspect,
  );
}

export type ThrottleServices = ReturnType<typeof createThrottle>;
