import type { DbSchnittstelle } from '../../../db/database';

export function rbFarbe(db: DbSchnittstelle, colorId: number) {
  return db.get<{ name: string; rgb: string | null }>('SELECT name, rgb FROM rb_colors WHERE id = $1', [colorId]);
}

export function manuelleTeilzeileSperren(tx: DbSchnittstelle, uid: number, partNumber: string, colorId: number) {
  return tx.get<{ id: number; storage_id: number | null }>(
    `SELECT id, storage_id FROM parts
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3
          AND source = 'manual'`,
    [uid, partNumber, colorId],
  );
}
