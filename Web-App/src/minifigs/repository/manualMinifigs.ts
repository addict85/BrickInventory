import type { DbInterface } from '../../../db/database';
import { blJoin, blNummerSql } from '../../../db/blMappingSql';
import type { EntryRow } from '../../../db/stockQuantity';
import type { Spalten } from '../../../db/rows';

/** The BrickLink number sits on the minifig (bl_mapping), not on the instance. */

export function manualMinifigRow(db: DbInterface, uid: number, figNumber: string): Promise<{ id: number } | undefined> {
  return db.get<Spalten<'minifigs', 'id'>>(
    "SELECT id FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'",
    [uid, figNumber],
  );
}

export function minifigRowWithCondition(db: DbInterface, uid: number, figNumber: string) {
  return db.get<{ id: number; bl_fig_number: string | null; condition: string | null }>(
    `SELECT m.id, ${blNummerSql('m.fig_number', 'z')} AS bl_fig_number,
            (SELECT a.condition FROM minifig_acquisitions a
              WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS condition
       FROM minifigs m
       ${blJoin('m.fig_number', 'fig', 'm.user_id', 'z')}
      WHERE m.user_id=$1 AND m.fig_number=$2 AND m.source='manual'`,
    [uid, figNumber],
  );
}

export function minifigAcquisitions(db: DbInterface, uids: number[], figNumber: string) {
  return db.all<EntryRow>(
    `SELECT a.id, a.quantity, a.unit_price,
            COALESCE(a.condition, 'N') AS condition, a.price_estimated, a.currency,
            a.created_at, a.user_id AS owner_user_id
     FROM minifig_acquisitions a
     WHERE a.user_id = ANY($1) AND a.fig_number=$2
     ORDER BY a.created_at ASC, a.id ASC`,
    [uids, figNumber],
  );
}
