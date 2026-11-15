import type { DbSchnittstelle } from '../../../db/database';
import type { BilderLesevertrag } from '../lesevertrag';

/** Alle Setnummern eines Blickfelds; `besitz` nur für Sets im Bestand. */
export function setsImBlickfeld(db: DbSchnittstelle, l: BilderLesevertrag, ids: number[]) {
  return db.all<{ set_number: string; besitz: boolean }>(l.gezaehlteSets('= ANY($1)'), [ids]);
}
