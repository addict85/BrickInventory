import type { DbSchnittstelle } from '../../../db/database';
import { gezaehlteSets } from '../../../db/bestandSicht';

/** Alle Setnummern eines Blickfelds; `besitz` nur für Sets im Bestand. */
export function setsImBlickfeld(db: DbSchnittstelle, ids: number[]) {
  return db.all<{ set_number: string; besitz: boolean }>(gezaehlteSets('= ANY($1)'), [ids]);
}
