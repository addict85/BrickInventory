import type { DbInterface } from '../../../db/database';
import type { ImagesReadContract } from '../readContract';

/** All set numbers of a scope; `owned` only for sets in the inventory. */
export function setsInScope(db: DbInterface, l: ImagesReadContract, ids: number[]) {
  return db.all<{ set_number: string; owned: boolean }>(l.countedSets('= ANY($1)'), [ids]);
}
