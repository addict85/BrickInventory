import { erfassungsTagSql, ENTRY_TABLES as SHAPES, type ErfassungsArt } from '../../../db/stockQuantity';
import type { DbInterface } from '../../../db/database';

export type NewestField = 'preis' | 'zustand';

/** Das Set wörtlich: Es gibt genau eine Stelle, die die letzte Set-Erfassung beschreibt. */
function newestSetEntry(db: DbInterface, feld: NewestField, wert: number | string | null, uid: number, sn: string) {
  const spalte = feld === 'preis' ? 'purchase_price' : 'condition';
  return db.run(
    `UPDATE set_acquisitions SET ${spalte} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [wert, uid, sn],
  );
}

/** 0 heisst bei Teilen und Figuren „für nichts gekauft“; ohne Preis steht NULL. */
export async function setNewest(
  db: DbInterface,
  art: ErfassungsArt,
  feld: NewestField,
  wert: number | string | null,
  uid: number,
  schluessel: (string | number)[],
): Promise<void> {
  if (art === 'set') {
    await newestSetEntry(db, feld, wert, uid, String(schluessel[0]));
    return;
  }
  const s = SHAPES[art];
  const wo = s.keys.map((k, i) => `a.${k} = $${i + 3}`).join(' AND ');
  const ziel = feld === 'preis' ? `${s.price} = NULLIF($1::numeric, 0)` : 'condition = $1';
  await db.run(
    `UPDATE ${s.table} SET ${ziel}
      WHERE id = (SELECT a.id FROM ${s.table} a WHERE a.user_id = $2 AND ${wo}
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1)`,
    [wert, uid, ...schluessel.slice(0, s.keys.length)],
  );
}

export function deletePartEntries(tx: DbInterface, besitzer: number, partNumber: string, colorId: number) {
  return tx.run('DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3', [
    besitzer,
    partNumber,
    colorId,
  ]);
}

export function deleteMinifigEntries(tx: DbInterface, besitzer: number, figNumber: string) {
  return tx.run('DELETE FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [besitzer, figNumber]);
}

/** Umfärben: Gleiche Käufe desselben Tags gehen in der neuen Farbe auf (eindeutiger Index). */
export function stallSameEntriesOn(tx: DbInterface, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(
    `UPDATE part_acquisitions z
          SET quantity = z.quantity + a.quantity
         FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
          AND ${erfassungsTagSql('z')} = ${erfassungsTagSql('a')}
          AND z.condition = a.condition AND z.price_estimated = a.price_estimated
          AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1)`,
    [uid, partNumber, alt, neu],
  );
}

export function deleteToppedUpEntries(tx: DbInterface, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(
    `DELETE FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND EXISTS (SELECT 1 FROM part_acquisitions z
                       WHERE z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
                         AND ${erfassungsTagSql('z')} = ${erfassungsTagSql('a')}
                         AND z.condition = a.condition AND z.price_estimated = a.price_estimated
                         AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1))`,
    [uid, partNumber, alt, neu],
  );
}

export function colorEntriesUm(tx: DbInterface, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(
    `UPDATE part_acquisitions SET color_id = $4
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3`,
    [uid, partNumber, alt, neu],
  );
}
