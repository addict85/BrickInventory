/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { bound, type Context } from '../infra/area';
import * as repository from './repository';
import type { Clock } from '../infra/clock';

export interface IdempotencyDependencies {
  clock: Clock;
  db: Db;
}

export const access = (db: Db) => ({
  repository: {
    receipts: bound(db)(repository.receipts),
    entry: bound(db)(repository.entry),
    withEffectNote: bound(db)(repository.withEffectNote),
    finish: bound(db)(repository.finish),
    deleteRunning: bound(db)(repository.deleteRunning),
    deleteOtherPrints: bound(db)(repository.deleteOtherPrints),
    deleteOlderAs: bound(db)(repository.deleteOlderAs),
    oldResponses: bound(db)(repository.oldResponses),
    replaceResponse: bound(db)(repository.replaceResponse),
  },
});
export type IdempotencyContext = Context<IdempotencyDependencies, ReturnType<typeof access>>;
