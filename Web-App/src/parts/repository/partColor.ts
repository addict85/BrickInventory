import type { DbInterface } from '../../../db/database';

export function rbColor(db: DbInterface, colorId: number) {
  return db.get<{ name: string; rgb: string | null }>('SELECT name, rgb FROM rb_colors WHERE id = $1', [colorId]);
}

export function lockManualPartRow(tx: DbInterface, uid: number, partNumber: string, colorId: number) {
  return tx.get<{ id: number; storage_id: number | null }>(
    `SELECT id, storage_id FROM parts
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3
          AND source = 'manual'`,
    [uid, partNumber, colorId],
  );
}
