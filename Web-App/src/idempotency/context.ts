/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/area';
import * as repository from './repository';
import type { Uhr } from '../infra/clock';

export interface IdempotencyDependencies {
  uhr: Uhr;
  db: Db;
}

export const access = (db: Db) => ({
  repository: {
    receipts: mit(db)(repository.receipts),
    eintrag: mit(db)(repository.eintrag),
    withEffectNote: mit(db)(repository.withEffectNote),
    closeAb: mit(db)(repository.closeAb),
    deleteRunning: mit(db)(repository.deleteRunning),
    deleteOtherPrints: mit(db)(repository.deleteOtherPrints),
    deleteOlderAs: mit(db)(repository.deleteOlderAs),
    oldResponses: mit(db)(repository.oldResponses),
    replaceResponse: mit(db)(repository.replaceResponse),
  },
});
export type IdempotencyContext = Kontext<IdempotencyDependencies, ReturnType<typeof access>>;
