import type { DbInterface } from '../../../db/database';
import { purchasePriceColumns } from '../../../db/moneySql';
import type { FinancesReadContract } from '../readContract';

/** `id` as second sort criterion: two acquisitions can carry the same
 * timestamp. */
export interface SetEntryRow {
  id: number;
  user_id: number;
  set_number: string;
  quantity: number;
  purchase_price: number | null;
  kaufpreis_fremd: boolean;
  kaufpreis_original: number | null;
  kaufpreis_umgerechnet: boolean;
  currency: string | null;
  price_estimated: boolean;
  condition: string;
  created_at: Date | null;
}

export function loadSetEntries(db: DbInterface, l: FinancesReadContract, uids: number[], currency: string) {
  return db.all<SetEntryRow>(
    `SELECT id, user_id, set_number, quantity,
            ${purchasePriceColumns('purchase_price', '$2')},
            currency, price_estimated,
            COALESCE(condition, 'N') AS condition, created_at
       FROM ${l.setErfassungen('= ANY($1)')} e
      WHERE user_id = ANY($1)
      ORDER BY created_at ASC, id ASC`,
    [uids, currency],
  );
}
