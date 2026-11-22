/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import * as service from './service';
import { access, type IdempotencyDependencies, type IdempotencyContext } from './context';

export type { IdempotencyDependencies, IdempotencyContext } from './context';

export function createIdempotency(a: IdempotencyDependencies, inspect?: Inspect<IdempotencyContext>) {
  return buildArea(
    a,
    access,
    (k: IdempotencyContext) => ({
      deleteOldFingerprints: bound(k)(service.deleteOldFingerprints),
      reencryptResponses: bound(k)(service.reencryptResponses),
      forgetAll: bound(k)(service.forgetAll),
      cleanupIdempotency: bound(k)(service.cleanupIdempotency),
      begin: bound(k)(service.begin),
      end: bound(k)(service.end),
      release: bound(k)(service.release),
      withEffectMark: bound(k)(service.withEffectMark),
    }),
    inspect,
  );
}

export type IdempotencyServices = ReturnType<typeof createIdempotency>;
