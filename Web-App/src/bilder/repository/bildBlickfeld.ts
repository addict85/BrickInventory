import type { DbInterface } from '../../../db/database';
import type { ImagesReadContract } from '../lesevertrag';

/** Alle Setnummern eines Blickfelds; `besitz` nur für Sets im Bestand. */
export function setsInScope(db: DbInterface, l: ImagesReadContract, ids: number[]) {
  return db.all<{ set_number: string; besitz: boolean }>(l.countedSets('= ANY($1)'), [ids]);
}
