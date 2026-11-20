/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { mit, buildArea, type Inspect } from '../infra/area';
import * as service from './service';
import { access, type IdempotencyDependencies, type IdempotencyContext } from './context';

export type { IdempotencyDependencies, IdempotencyContext } from './context';

export function createIdempotency(a: IdempotencyDependencies, inspect?: Inspect<IdempotencyContext>) {
  return buildArea(
    a,
    access,
    (k: IdempotencyContext) => ({
      deleteOldFingerprints: mit(k)(service.deleteOldFingerprints),
      reencryptResponses: mit(k)(service.reencryptResponses),
      forgetAll: mit(k)(service.forgetAll),
      cleanupIdempotency: mit(k)(service.cleanupIdempotency),
      begin: mit(k)(service.begin),
      end: mit(k)(service.end),
      release: mit(k)(service.release),
      withEffectMark: mit(k)(service.withEffectMark),
    }),
    inspect,
  );
}

export type IdempotencyServices = ReturnType<typeof createIdempotency>;
