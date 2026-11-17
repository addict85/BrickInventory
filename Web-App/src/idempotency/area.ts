/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as service from './service';
import { access, type IdempotencyDependencies, type IdempotencyContext } from './context';

export type { IdempotencyDependencies, IdempotencyContext } from './context';

export function createIdempotency(a: IdempotencyDependencies, einblick?: Einblick<IdempotencyContext>) {
  return baueBereich(
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
    einblick,
  );
}

export type IdempotencyServices = ReturnType<typeof createIdempotency>;
