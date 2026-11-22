/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { buildArea, withValue, type Inspect } from '../infra/area';
import * as counter from './counter';
import { access, type ThrottleDependencies, type ThrottleContext } from './context';

export type { ThrottleDependencies, ThrottleContext } from './context';

/** Login attempts, balance lookups and source fetches all count in one table; only this area may write. */
export function createThrottle(a: ThrottleDependencies, inspect?: Inspect<ThrottleContext>) {
  return buildArea(
    a,
    access,
    (k: ThrottleContext) => ({
      counterState: withValue(k)(counter.counterState),
      countAttempt: withValue(k)(counter.countAttempt),
      reserve: withValue(k)(counter.reserve),
      releaseSlot: withValue(k)(counter.releaseSlot),
      forgetCounter: withValue(k)(counter.forgetCounter),
      countInWindow: withValue(k)(counter.countInWindow),
      cleanUp: withValue(k)(counter.cleanUp),
      oncePerDay: withValue(k)(counter.oncePerDay),
      hourlyState: k.counter.hourlyState,
      countHour: k.counter.countHour,
    }),
    inspect,
  );
}

export type ThrottleServices = ReturnType<typeof createThrottle>;
