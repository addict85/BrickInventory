import type { DbInterface, Treffer } from '../../../db/database';

export async function hatInstructions(tx: DbInterface, uid: number, sn: string): Promise<boolean> {
  return !!(await tx.get<Treffer>('SELECT 1 AS ok FROM instructions WHERE user_id=$1 AND set_number=$2 LIMIT 1', [
    uid,
    sn,
  ]));
}

export async function removeInstructions(tx: DbInterface, uid: number, sn: string): Promise<void> {
  await tx.run('DELETE FROM instructions WHERE user_id=$1 AND set_number=$2', [uid, sn]);
}

/** Parts and figures are copied by the inventory (src/inventory/shared.ts). */
export async function copyInstructions(tx: DbInterface, sn: string, fromValue: number, nach: number): Promise<number> {
  return (
    (
      await tx.run(
        `INSERT INTO instructions (user_id, set_number, url, description, local_path)
                   SELECT $1, set_number, url, description, local_path
                     FROM instructions WHERE user_id = $2 AND set_number = $3`,
        [nach, fromValue, sn],
      )
    ).changes ?? 0
  );
}

/** Columns written out: a star silently loses a deleted column. */
export function setRow(tx: DbInterface, uid: number, sn: string) {
  return tx.get<{ id: number; added_at: string }>(
    'SELECT id, user_id, set_number, added_at, updated_at, storage_id FROM sets WHERE user_id=$1 AND set_number=$2',
    [uid, sn],
  );
}

export type SetEntry = {
  id: number;
  quantity: number;
  purchase_price: number | null;
  condition: string;
  created_at: string;
  price_estimated: boolean;
  currency: string;
};

export function moveEntriesTo(tx: DbInterface, uid: number, sn: string): Promise<SetEntry[]> {
  return tx.all<SetEntry>(
    `SELECT id, quantity, purchase_price, COALESCE(condition,'N') AS condition, created_at, price_estimated, currency
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY created_at ASC, id ASC`,
    [uid, sn],
  );
}
