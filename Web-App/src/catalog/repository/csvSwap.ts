import { maintainTable } from '../../../db/maintainTable';
import type { DbInterface } from '../../../db/types';
import type { CatalogReadContract } from '../readContract';
import { LOCKS } from '../../infra/lockNamespaces';

/** Every step takes the handle of ONE transaction (db.transaction): lock, shadow and swap
 * end with it, so an abort anywhere leaves the old table and no leftovers. Table and
 * column names come only from the source code. */

/** The repository swaps only these tables; another name throws instead of clearing a foreign one. */
export const CSV_TABLES = [
  'rb_colors',
  'rb_part_categories',
  'rb_parts',
  'rb_sets',
  'rb_inventories',
  'rb_themes',
  'rb_inventory_minifigs',
  'rb_inventory_parts',
] as const;
export type CsvTable = (typeof CSV_TABLES)[number];

function onlyCsvTable(table: string): CsvTable {
  const t = CSV_TABLES.find(x => x === table);
  if (!t) throw new Error(`keine CSV-Tabelle: ${table}`);
  return t;
}

function lockKey(table: string): number {
  let h = 0;
  for (let i = 0; i < table.length; i++) h = (Math.imul(h, 31) + table.charCodeAt(i)) | 0;
  return h;
}

/** Held until the end of the transaction. A running swap of the same table may take longer than lock_timeout. */
export async function lockTable(tx: DbInterface, table: string): Promise<void> {
  await tx.exec('SET LOCAL lock_timeout = 0');
  await tx.run('SELECT pg_advisory_xact_lock($1, $2)', [LOCKS.CSV_IMPORT, lockKey(table)]);
}

/** With keys (ON CONFLICT needs them), without CHECKs (checked on swap, after the
 * target table's triggers), temporary (the runtime role may not create anything in public). */
export async function createShadow(tx: DbInterface, table: CsvTable, shadow: string): Promise<void> {
  await tx.exec(`DROP TABLE IF EXISTS pg_temp.${shadow}`);
  await tx.exec(
    `CREATE TEMP TABLE ${shadow} (LIKE ${onlyCsvTable(table)} INCLUDING ALL EXCLUDING CONSTRAINTS) ON COMMIT DROP`,
  );
}

/** A rejected chunk aborts the import. */
/** Key columns: a duplicate row in the CSV overwrites the earlier one; 'ignorieren' keeps it. */
export type Conflict = string[] | 'ignorieren';

function onConflict(columns: string[], k: Conflict | undefined): string {
  if (!k) return '';
  if (k === 'ignorieren') return 'ON CONFLICT DO NOTHING';
  const rest = columns.filter(s => !k.includes(s)).map(s => `${s}=EXCLUDED.${s}`);
  return `ON CONFLICT (${k.join(',')}) DO UPDATE SET ${rest.join(',')}`;
}

export async function addBlockOne(
  tx: DbInterface,
  shadow: string,
  columns: string[],
  block: unknown[][],
  conflict?: Conflict,
): Promise<void> {
  const n = columns.length;
  const slot = block.map((_, j) => '(' + columns.map((_, k) => `$${j * n + k + 1}`).join(',') + ')').join(',');
  await tx.run(
    `INSERT INTO ${shadow} (${columns.join(',')}) VALUES ${slot} ${onConflict(columns, conflict)}`,
    block.flat(),
  );
}

export async function swap(tx: DbInterface, table: CsvTable, shadow: string, columns: string[]): Promise<void> {
  const target = onlyCsvTable(table);
  await tx.run(`DELETE FROM ${target}`);
  await tx.run(`INSERT INTO ${target} (${columns.join(',')}) SELECT ${columns.join(',')} FROM ${shadow}`);
}

/** rb_sets mirrors the dump: insert, update, remove. Only a set to which
 * inventory, wishlist or price alert is attached stays as an 'api' row, otherwise
 * an account would lose name and image. Afterwards every row has its set_catalog entry (0105). */
export async function syncSets(
  tx: DbInterface,
  l: Pick<CatalogReadContract, 'setZaehlt'>,
  shadow: string,
  columns: string[],
): Promise<void> {
  const fresh = columns.filter(s => s !== 'set_num');
  const vanished = `NOT EXISTS (SELECT 1 FROM ${shadow} n WHERE n.set_num = rb_sets.set_num)`;
  const basis = l.setZaehlt('rb_sets.set_num');
  await tx.run(`INSERT INTO rb_sets (${columns.join(',')}, source) SELECT ${columns.join(',')}, 'csv' FROM ${shadow}
                   ON CONFLICT (set_num) DO UPDATE SET ${fresh.map(s => `${s}=EXCLUDED.${s}`).join(',')}, source='csv'
                   WHERE (${fresh.map(s => `rb_sets.${s}`).join(',')}, rb_sets.source)
                         IS DISTINCT FROM (${fresh.map(s => `EXCLUDED.${s}`).join(',')}, 'csv')`);
  await tx.run(`UPDATE rb_sets SET source = 'api' WHERE source = 'csv' AND ${vanished} AND ${basis}`);
  // set_catalog goes along via ON DELETE CASCADE.
  await tx.run(`DELETE FROM rb_sets WHERE ${vanished} AND NOT ${basis}`);
  // The CSV's image address only applies in set_catalog, the only image source (0108).
  await tx.run(`INSERT INTO set_catalog (set_number, image_url)
                 SELECT set_num, NULLIF(set_img_url, '') FROM rb_sets WHERE set_num ~ '-[0-9]+$'
                 ON CONFLICT (set_number) DO UPDATE SET image_url = EXCLUDED.image_url, updated_at = NOW()
                 WHERE set_catalog.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL`);
}

/** After a complete swap the planner statistics are meaningless. Outside any transaction:
 * VACUUM refuses to run inside one. */
export function maintenance(runOutsideTx: (sql: string) => Promise<unknown>, table: string) {
  return maintainTable(runOutsideTx, table);
}
