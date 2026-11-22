import type { DbInterface } from '../../../db/database';
import type { EntryRow } from '../../../db/stockQuantity';
import type { Columns } from '../../../db/rows';

/** Price and condition live in the LATEST acquisition, the stock row only holds the key —
 * the quantity is the sum of the acquisitions. */

export function manualPartRow(
  db: DbInterface,
  uid: number,
  partNumber: string,
  colorId: number,
): Promise<{ id: number } | undefined> {
  return db.get<Columns<'parts', 'id'>>(
    "SELECT id FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [uid, partNumber, colorId],
  );
}

export function manualPartWithCondition(db: DbInterface, uid: number, partNumber: string, colorId: number) {
  return db.get<{ id: number; condition: string | null }>(
    `SELECT p.id,
            (SELECT a.condition FROM part_acquisitions a
              WHERE a.user_id = p.user_id AND a.part_number = p.part_number
                AND a.color_id = p.color_id
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS condition
       FROM parts p
      WHERE p.user_id=$1 AND p.part_number=$2 AND p.color_id=$3 AND p.source='manual'`,
    [uid, partNumber, colorId],
  );
}

export async function rbColorHex(db: DbInterface, colorId: number): Promise<string | null> {
  return (await db.get<{ rgb: string | null }>('SELECT rgb FROM rb_colors WHERE id=$1', [colorId]))?.rgb || null;
}

export function partAcquisitions(db: DbInterface, uids: number[], partNumber: string, colorId: number) {
  return db.all<EntryRow>(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition, a.price_estimated, a.currency,
            a.created_at, a.user_id AS owner_user_id
     FROM part_acquisitions a
     WHERE a.user_id = ANY($1) AND a.part_number=$2 AND a.color_id=$3
     ORDER BY a.created_at ASC, a.id ASC`,
    [uids, partNumber, colorId],
  );
}
