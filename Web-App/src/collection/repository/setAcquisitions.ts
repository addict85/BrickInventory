import type { DbInterface } from '../../../db/database';
import type { EntryRow } from '../../../db/stockQuantity';
import { setAcquisitions } from '../../../db/inventoryView';

export function setAcquisitionsInScope(db: DbInterface, scope: number[], setNumber: string) {
  return db.all<EntryRow>(
    `SELECT id, quantity, purchase_price, COALESCE(condition, 'N') AS condition, price_estimated, currency,
            created_at, user_id AS owner_user_id FROM ${setAcquisitions('= ANY($1)')} a
      WHERE set_number=$2 ORDER BY created_at ASC, id ASC`,
    [scope, setNumber],
  );
}
