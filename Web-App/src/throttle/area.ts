/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { buildArea, bound, type Inspect } from '../infra/area';
import * as counter from './counter';
import { access, type ThrottleDependencies, type ThrottleContext } from './context';

export type { ThrottleDependencies, ThrottleContext } from './context';

/** Login attempts, balance lookups and source fetches count in rate_limit_attempts, the API
 * budget in api_budget; only this area may write them. */
export function createThrottle(a: ThrottleDependencies, inspect?: Inspect<ThrottleContext>) {
  return buildArea(
    a,
    access,
    (k: ThrottleContext) => ({
      counterState: bound(k)(counter.counterState),
      countAttempt: bound(k)(counter.countAttempt),
      reserve: bound(k)(counter.reserve),
      releaseSlot: bound(k)(counter.releaseSlot),
      forgetCounter: bound(k)(counter.forgetCounter),
      countInWindow: bound(k)(counter.countInWindow),
      cleanUp: bound(k)(counter.cleanUp),
      oncePerDay: bound(k)(counter.oncePerDay),
      hourlyState: k.counter.hourlyState,
      countHour: k.counter.countHour,
      claimApiBudget: k.apiBudget.claim,
    }),
    inspect,
  );
}

export type ThrottleServices = ReturnType<typeof createThrottle>;
