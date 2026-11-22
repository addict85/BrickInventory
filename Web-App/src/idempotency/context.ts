/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { withValue, type Context } from '../infra/area';
import * as repository from './repository';
import type { Clock } from '../infra/clock';

export interface IdempotencyDependencies {
  uhr: Clock;
  db: Db;
}

export const access = (db: Db) => ({
  repository: {
    receipts: withValue(db)(repository.receipts),
    eintrag: withValue(db)(repository.entry),
    withEffectNote: withValue(db)(repository.withEffectNote),
    closeAb: withValue(db)(repository.finish),
    deleteRunning: withValue(db)(repository.deleteRunning),
    deleteOtherPrints: withValue(db)(repository.deleteOtherPrints),
    deleteOlderAs: withValue(db)(repository.deleteOlderAs),
    oldResponses: withValue(db)(repository.oldResponses),
    replaceResponse: withValue(db)(repository.replaceResponse),
  },
});
export type IdempotencyContext = Context<IdempotencyDependencies, ReturnType<typeof access>>;
