import { mengeAus, subsetFrom } from '../../../db/stockQuantity';
import type { InventoryReadContract } from '../readContract';
import type { DbInterface } from '../../../db/database';

export function setNumbers(db: DbInterface, l: InventoryReadContract, uids: number[]) {
  return db.get<{ total_sets: string; total_quantity: string }>(
    `SELECT COUNT(DISTINCT s.set_number) AS total_sets,
                   COALESCE(SUM(${mengeAus()}), 0) AS total_quantity
              FROM ${l.setBestand('= ANY($1)')} s
              ${l.mengeJoin('s', 'sm', '= ANY($1)')}
             WHERE s.user_id = ANY($1)`,
    [uids],
  );
}

export function instructionNumbers(db: DbInterface, l: InventoryReadContract, uids: number[], own: number[]) {
  return db.get<{ total_instructions: string }>(
    `
      SELECT
        (SELECT COUNT(*) FROM shared_instructions si
           JOIN ${l.setBestand('= ANY($1)')} s ON s.set_number = si.set_number) +
        (SELECT COUNT(*) FROM ${l.anleitungen('= ANY($2)')} i) AS total_instructions`,
    [uids, own],
  );
}

export function partsInInventory(db: DbInterface, l: InventoryReadContract, uids: number[]) {
  return db.get<{ t: string | null }>(
    `SELECT SUM(${subsetFrom('p', 'part')}*${mengeAus('sm', 1)}) AS t
              FROM parts p ${l.mengeJoin('p', 'sm', '= ANY($1)')} ${l.teilmengeJoin('p', 'part')}
             WHERE p.user_id = ANY($1)`,
    [uids],
  );
}

/** Only the individually captured parts, for the breakdown "from sets · individually". */
export function partsSingle(db: DbInterface, l: InventoryReadContract, uids: number[]) {
  return db.get<{ t: string | null }>(
    `SELECT SUM(${subsetFrom('p', 'part')}*${mengeAus('sm', 1)}) AS t
              FROM parts p ${l.mengeJoin('p', 'sm', '= ANY($1)')} ${l.teilmengeJoin('p', 'part')}
             WHERE p.user_id = ANY($1) AND p.source = 'manual'`,
    [uids],
  );
}

export function minifigsInInventory(db: DbInterface, l: InventoryReadContract, uids: number[]) {
  return db.get<{ t: string | null }>(
    `SELECT SUM(${subsetFrom('m', 'fig')}*${mengeAus('sm', 1)}) AS t
              FROM minifigs m ${l.mengeJoin('m', 'sm', '= ANY($1)')} ${l.teilmengeJoin('m', 'fig')}
             WHERE m.user_id = ANY($1)`,
    [uids],
  );
}
