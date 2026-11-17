import type { DbSchnittstelle } from '../../../db/database';
import type { ErfassungsZeile } from '../../../db/bestandsmenge';
import { setErfassungen } from '../../../db/bestandSicht';

export function setAcquisitionsInScope(db: DbSchnittstelle, blickfeld: number[], setNumber: string) {
  return db.all<ErfassungsZeile>(
    `SELECT id, quantity, purchase_price, COALESCE(condition, 'N') AS condition, price_estimated, currency,
            created_at, user_id AS owner_user_id FROM ${setErfassungen('= ANY($1)')} a
      WHERE set_number=$2 ORDER BY created_at ASC, id ASC`,
    [blickfeld, setNumber],
  );
}
