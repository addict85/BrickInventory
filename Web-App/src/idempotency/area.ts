/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import * as service from './service';
import { access, type IdempotencyDependencies, type IdempotencyContext } from './context';

export type { IdempotencyDependencies, IdempotencyContext } from './context';

export function createIdempotency(a: IdempotencyDependencies, inspect?: Inspect<IdempotencyContext>) {
  return buildArea(
    a,
    access,
    (k: IdempotencyContext) => ({
      deleteOldFingerprints: withValue(k)(service.deleteOldFingerprints),
      reencryptResponses: withValue(k)(service.reencryptResponses),
      forgetAll: withValue(k)(service.forgetAll),
      cleanupIdempotency: withValue(k)(service.cleanupIdempotency),
      begin: withValue(k)(service.begin),
      end: withValue(k)(service.end),
      release: withValue(k)(service.release),
      withEffectMark: withValue(k)(service.withEffectMark),
    }),
    inspect,
  );
}

export type IdempotencyServices = ReturnType<typeof createIdempotency>;
