import { erfassungsTagSql } from '../../../db/bestandsmenge';
import type { DbSchnittstelle } from '../../../db/database';
import * as db from '../../../db/database';

export function rbFarbe(colorId: number) {
  return db.get<{ name: string; rgb: string | null }>('SELECT name, rgb FROM rb_colors WHERE id = $1', [colorId]);
}

export function manuelleTeilzeileSperren(tx: DbSchnittstelle, uid: number, partNumber: string, colorId: number) {
  return tx.get<{ id: number; storage_id: number | null }>(`SELECT id, storage_id FROM parts
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3
          AND source = 'manual'`, [uid, partNumber, colorId]);
}

export function stockeGleicheErfassungenAuf(tx: DbSchnittstelle, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(`UPDATE part_acquisitions z
          SET quantity = z.quantity + a.quantity
         FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
          AND ${erfassungsTagSql('z')} = ${erfassungsTagSql('a')}
          AND z.condition = a.condition AND z.price_estimated = a.price_estimated
          AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1)`, [uid, partNumber, alt, neu]);
}

export function loescheAufgestockteErfassungen(tx: DbSchnittstelle, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(`DELETE FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND EXISTS (SELECT 1 FROM part_acquisitions z
                       WHERE z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
                         AND ${erfassungsTagSql('z')} = ${erfassungsTagSql('a')}
                         AND z.condition = a.condition AND z.price_estimated = a.price_estimated
                         AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1))`, [uid, partNumber, alt, neu]);
}

export function faerbeErfassungenUm(tx: DbSchnittstelle, uid: number, partNumber: string, alt: number, neu: number) {
  return tx.run(`UPDATE part_acquisitions SET color_id = $4
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3`, [uid, partNumber, alt, neu]);
}

export function setzeTeilLagerort(tx: DbSchnittstelle, storageId: number, id: number) {
  return tx.run('UPDATE parts SET storage_id = $1 WHERE id = $2', [storageId, id]);
}

export function loescheTeilzeile(tx: DbSchnittstelle, id: number) {
  return tx.run('DELETE FROM parts WHERE id = $1', [id]);
}

export function faerbeTeilzeileUm(tx: DbSchnittstelle, colorId: number, id: number) {
  return tx.run('UPDATE parts SET color_id = $1 WHERE id = $2', [colorId, id]);
}
