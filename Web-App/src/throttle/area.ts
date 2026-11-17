/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { baueBereich, mit, type Einblick } from '../infra/bereich';
import * as counter from './counter';
import { access, type ThrottleDependencies, type ThrottleContext } from './context';

export type { ThrottleDependencies, ThrottleContext } from './context';

/** Login attempts, balance lookups and source fetches all count in one table; only this area may write. */
export function createThrottle(a: ThrottleDependencies, einblick?: Einblick<ThrottleContext>) {
  return baueBereich(
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
    einblick,
  );
}

export type ThrottleServices = ReturnType<typeof createThrottle>;
