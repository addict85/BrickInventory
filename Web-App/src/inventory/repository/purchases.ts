import { acquisitionDaySql, ENTRY_TABLES as SHAPES, type AcquisitionKind } from '../../../db/stockQuantity';
import type { DbInterface } from '../../../db/database';

export type NewestField = 'preis' | 'zustand';

/** The set literally: there is exactly one place that describes the last set acquisition. */
function newestSetEntry(db: DbInterface, field: NewestField, wert: number | string | null, uid: number, sn: string) {
  const column = field === 'preis' ? 'purchase_price' : 'condition';
  return db.run(
    `UPDATE set_acquisitions SET ${column} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [wert, uid, sn],
  );
}

/** For parts and figures 0 means "bought for nothing"; without a price NULL stands there. */
export async function setNewest(
  db: DbInterface,
  kind: AcquisitionKind,
  field: NewestField,
  wert: number | string | null,
  uid: number,
  key: (string | number)[],
): Promise<void> {
  if (kind === 'set') {
    await newestSetEntry(db, field, wert, uid, String(key[0]));
    return;
  }
  const s = SHAPES[kind];
  const wo = s.keys.map((k, i) => `a.${k} = $${i + 3}`).join(' AND ');
  const target = field === 'preis' ? `${s.price} = NULLIF($1::numeric, 0)` : 'condition = $1';
  await db.run(
    `UPDATE ${s.table} SET ${target}
      WHERE id = (SELECT a.id FROM ${s.table} a WHERE a.user_id = $2 AND ${wo}
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
    [wert, uid, ...key.slice(0, s.keys.length)],
  );
}

export function deletePartEntries(tx: DbInterface, owner: number, partNumber: string, colorId: number) {
  return tx.run('DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3', [
    owner,
    partNumber,
    colorId,
  ]);
}

export function deleteMinifigEntries(tx: DbInterface, owner: number, figNumber: string) {
  return tx.run('DELETE FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [owner, figNumber]);
}

/** Recoloring: identical purchases of the same day merge into the new color (unique index). */
export function stallSameEntriesOn(tx: DbInterface, uid: number, partNumber: string, alt: number, fresh: number) {
  return tx.run(
    `UPDATE part_acquisitions z
          SET quantity = z.quantity + a.quantity
         FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
          AND ${acquisitionDaySql('z')} = ${acquisitionDaySql('a')}
          AND z.condition = a.condition AND z.price_estimated = a.price_estimated
          AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1)`,
    [uid, partNumber, alt, fresh],
  );
}

export function deleteToppedUpEntries(tx: DbInterface, uid: number, partNumber: string, alt: number, fresh: number) {
  return tx.run(
    `DELETE FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND EXISTS (SELECT 1 FROM part_acquisitions z
                       WHERE z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
                         AND ${acquisitionDaySql('z')} = ${acquisitionDaySql('a')}
                         AND z.condition = a.condition AND z.price_estimated = a.price_estimated
                         AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1))`,
    [uid, partNumber, alt, fresh],
  );
}

export function recolorEntries(tx: DbInterface, uid: number, partNumber: string, alt: number, fresh: number) {
  return tx.run(
    `UPDATE part_acquisitions SET color_id = $4
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3`,
    [uid, partNumber, alt, fresh],
  );
}
