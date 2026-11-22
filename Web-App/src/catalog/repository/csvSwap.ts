import type { PoolClient } from 'pg';
import { maintainTable } from '../../../db/maintainTable';
import type { CatalogReadContract } from '../readContract';
import { LOCKS } from '../../infra/lockNamespaces';
import { logAndContinue } from '../../infra/error';

/** On ONE connection, because session lock, shadow and transaction are bound
 * to it. Table and column names come only from the source code. */

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

export async function lockTable(c: PoolClient, table: string): Promise<void> {
  // A running swap of the same table may take longer than lock_timeout.
  await c.query('SET lock_timeout = 0');
  await c.query('SELECT pg_advisory_lock($1, $2)', [LOCKS.CSV_IMPORT, lockKey(table)]);
}

export async function giveTableFree(c: PoolClient, table: string): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, $2)', [LOCKS.CSV_IMPORT, lockKey(table)]);
  await c.query('RESET lock_timeout');
}

/** With keys (ON CONFLICT needs them), without CHECKs (checked on swap, after the
 * target table's triggers), temporary (the runtime role may not create anything in public). */
export async function createShadow(c: PoolClient, table: CsvTable, shadow: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS pg_temp.${shadow}`);
  await c.query(`CREATE TEMP TABLE ${shadow} (LIKE ${onlyCsvTable(table)} INCLUDING ALL EXCLUDING CONSTRAINTS)`);
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
  c: PoolClient,
  shadow: string,
  columns: string[],
  block: unknown[][],
  conflict?: Conflict,
): Promise<void> {
  const n = columns.length;
  const slot = block.map((_, j) => '(' + columns.map((_, k) => `$${j * n + k + 1}`).join(',') + ')').join(',');
  await c.query(
    `INSERT INTO ${shadow} (${columns.join(',')}) VALUES ${slot} ${onConflict(columns, conflict)}`,
    block.flat(),
  );
}

async function inStep(c: PoolClient, steps: () => Promise<void>): Promise<void> {
  await c.query('BEGIN');
  try {
    await steps();
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(logAndContinue('csv-tausch:rollback'));
    throw e;
  }
}

export function swap(c: PoolClient, table: CsvTable, shadow: string, columns: string[]): Promise<void> {
  const target = onlyCsvTable(table);
  return inStep(c, async () => {
    await c.query(`DELETE FROM ${target}`);
    await c.query(`INSERT INTO ${target} (${columns.join(',')}) SELECT ${columns.join(',')} FROM ${shadow}`);
  });
}

/** rb_sets mirrors the dump: insert, update, remove. Only a set to which
 * inventory, wishlist or price alert is attached stays as an 'api' row, otherwise
 * an account would lose name and image. Afterwards every row has its set_catalog entry (0105). */
export async function syncSets(
  c: PoolClient,
  l: Pick<CatalogReadContract, 'setZaehlt'>,
  shadow: string,
  columns: string[],
): Promise<void> {
  const fresh = columns.filter(s => s !== 'set_num');
  const vanished = `NOT EXISTS (SELECT 1 FROM ${shadow} n WHERE n.set_num = rb_sets.set_num)`;
  const basis = l.setZaehlt('rb_sets.set_num');
  await inStep(c, async () => {
    await c.query(`INSERT INTO rb_sets (${columns.join(',')}, source) SELECT ${columns.join(',')}, 'csv' FROM ${shadow}
                   ON CONFLICT (set_num) DO UPDATE SET ${fresh.map(s => `${s}=EXCLUDED.${s}`).join(',')}, source='csv'
                   WHERE (${fresh.map(s => `rb_sets.${s}`).join(',')}, rb_sets.source)
                         IS DISTINCT FROM (${fresh.map(s => `EXCLUDED.${s}`).join(',')}, 'csv')`);
    await c.query(`UPDATE rb_sets SET source = 'api' WHERE source = 'csv' AND ${vanished} AND ${basis}`);
    // set_catalog goes along via ON DELETE CASCADE.
    await c.query(`DELETE FROM rb_sets WHERE ${vanished} AND NOT ${basis}`);
    // The CSV's image address only applies in set_catalog, the only image source (0108).
    await c.query(`INSERT INTO set_catalog (set_number, image_url)
                   SELECT set_num, NULLIF(set_img_url, '') FROM rb_sets WHERE set_num ~ '-[0-9]+$'
                   ON CONFLICT (set_number) DO UPDATE SET image_url = EXCLUDED.image_url, updated_at = NOW()
                   WHERE set_catalog.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL`);
  });
}

export async function removeShadow(c: PoolClient, shadow: string): Promise<void> {
  await c.query(`DROP TABLE IF EXISTS pg_temp.${shadow}`);
}

/** After a complete swap the planner statistics are meaningless. */
export function maintenance(c: PoolClient, table: string) {
  return maintainTable(sql => c.query(sql), table);
}
