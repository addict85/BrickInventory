import type { DbInterface } from '../../../db/database';
import type { InventoryReadContract } from '../readContract';

const TABLES = { set: 'sets', part: 'parts', fig: 'minifigs' } as const;
export type StorageTable = keyof typeof TABLES;

const CONDITION_SQL: Record<StorageTable, (ab: number) => string> = {
  set: ab => `set_number = $${ab}`,
  part: ab => `part_number = $${ab} AND color_id = $${ab + 1}`,
  fig: ab => `fig_number = $${ab}`,
};

/** By name in the stock of the OWN account: in the household the same name can
 * exist in two accounts with their own ID each. */
export async function sortLocationTo(
  dbh: DbInterface,
  art: StorageTable,
  owner: number[],
  ort: string | null,
  key: string[],
): Promise<number> {
  const r = await dbh.run(
    `UPDATE ${TABLES[art]} t
        SET storage_id = (SELECT l.id FROM storage_locations l
                           WHERE l.user_id = t.user_id
                             AND lower(l.name) = lower($2))
      WHERE t.user_id = ANY($1) AND ${CONDITION_SQL[art](3)}`,
    [owner, ort, ...key],
  );
  return r.changes ?? 0;
}

export async function ownerWithRow(
  tx: DbInterface,
  art: StorageTable,
  owner: number[],
  key: string[],
): Promise<number[]> {
  const rows = await tx.all<{ user_id: number }>(
    `SELECT DISTINCT t.user_id FROM ${TABLES[art]} t
      WHERE t.user_id = ANY($1) AND ${CONDITION_SQL[art](2)}`,
    [owner, ...key],
  );
  return rows.map(b => parseInt(String(b.user_id), 10));
}

export async function takeLocationOn(tx: DbInterface, ids: number[], ort: string): Promise<void> {
  await tx.run(
    `INSERT INTO storage_locations (user_id, name)
     SELECT id, $2 FROM users WHERE id = ANY($1)
     ON CONFLICT (user_id, lower(name)) DO NOTHING`,
    [ids, ort],
  );
}

export function locationsTheAccounts(db: DbInterface, userIds: number[]) {
  return db.all<{ id: number; user_id: number; name: string }>(
    `SELECT id, user_id, name FROM storage_locations
      WHERE user_id = ANY($1) ORDER BY lower(name)`,
    [userIds],
  );
}

/** Case-insensitively unique per account; null if it already exists. */
export function addLocationOne(db: DbInterface, userId: number, name: string) {
  return db.get<{ id: number; user_id: number; name: string }>(
    `INSERT INTO storage_locations (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, lower(name)) DO NOTHING
     RETURNING id, user_id, name`,
    [userId, name],
  );
}

export function ortNachName(db: DbInterface, userId: number, name: string) {
  return db.get<{ id: number; user_id: number; name: string }>(
    'SELECT id, user_id, name FROM storage_locations WHERE user_id = $1 AND lower(name) = lower($2)',
    [userId, name],
  );
}

export function ortName(db: DbInterface, id: number, userId: number) {
  return db.get<{ name: string }>('SELECT name FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
}

export function otherLocationSameNamed(db: DbInterface, userId: number, name: string, id: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM storage_locations
      WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3`,
    [userId, name, id],
  );
}

export function writeLocationNames(db: DbInterface, id: number, userId: number, name: string) {
  return db.run('UPDATE storage_locations SET name = $3 WHERE id = $1 AND user_id = $2', [id, userId, name]);
}

export function locationOccupancy(db: DbInterface, l: InventoryReadContract, userId: number, id: number) {
  return db.get<{ n: string }>(
    `SELECT (SELECT COUNT(*) FROM ${l.setBestand('= $1')} s WHERE storage_id = $2)
          + (SELECT COUNT(*) FROM parts    WHERE user_id = $1 AND storage_id = $2)
          + (SELECT COUNT(*) FROM minifigs WHERE user_id = $1 AND storage_id = $2) AS n`,
    [userId, id],
  );
}

export function removeLocation(db: DbInterface, id: number, userId: number) {
  return db.run('DELETE FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
}

export function locationsWithInventory(db: DbInterface, l: InventoryReadContract, uids: number[]) {
  return db.all<{ ort: string; sets: number; teile: number; figuren: number }>(
    `SELECT ort,
            SUM(sets)::int    AS sets,
            SUM(teile)::int   AS teile,
            SUM(figuren)::int AS figuren
       FROM (
         SELECT l.name AS ort, COUNT(*)::int AS sets, 0 AS teile, 0 AS figuren
           FROM ${l.setBestand('= ANY($1)')} s JOIN storage_locations l ON l.id = s.storage_id
          WHERE s.user_id = ANY($1)
          GROUP BY l.name
         UNION ALL
         SELECT l.name AS ort, 0 AS sets, COUNT(*)::int AS teile, 0 AS figuren
           FROM parts p JOIN storage_locations l ON l.id = p.storage_id
          WHERE p.user_id = ANY($1)
          GROUP BY l.name
         UNION ALL
         SELECT l.name AS ort, 0 AS sets, 0 AS teile, COUNT(*)::int AS figuren
           FROM minifigs m JOIN storage_locations l ON l.id = m.storage_id
          WHERE m.user_id = ANY($1)
          GROUP BY l.name
       ) q
      GROUP BY ort
      ORDER BY ort`,
    [uids],
  );
}

export function locationOfAccount(db: DbInterface, id: number, userId: number) {
  return db.get<{ id: number; user_id: number; name: string }>(
    'SELECT id, user_id, name FROM storage_locations WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
}
