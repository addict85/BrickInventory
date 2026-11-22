import type { DbInterface } from '../../../db/database';

export interface CatalogEntry {
  is_gear?: boolean | null;
  bl_type?: string | null;
  fetched_at?: string | Date | null;
}

/** With the version suffix, as it is stored. */
export async function catalogEntryTo(db: DbInterface, number: string): Promise<CatalogEntry | null> {
  return (
    (await db.get<CatalogEntry>('SELECT is_gear, bl_type, fetched_at FROM catalog_cache WHERE set_number = $1', [
      number,
    ])) ?? null
  );
}

/** A set that one of our catalogs really knows. A "no price" marker
 * does not count: it only arises from the fetch this check is meant to prevent. */
export async function setInCatalog(db: DbInterface, number: string): Promise<boolean> {
  const r = await db.get<{ x: number }>(
    `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM set_catalog WHERE set_number = $1)
                      OR EXISTS (SELECT 1 FROM rb_sets WHERE set_num = $1)
                      OR EXISTS (SELECT 1 FROM catalog_cache WHERE set_number = $1
                                  AND NOT (is_gear IS TRUE AND bl_type = 'NONE'))`,
    [number],
  );
  return !!r;
}

export type BricklinkArt = 'GEAR' | 'BOOK' | 'NONE';

/** NONE means "no price", with a timestamp. */
export async function rememberBricklinkKind(db: DbInterface, number: string, art: BricklinkArt): Promise<void> {
  if (art === 'NONE') {
    await db.run(
      `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1,$2,true)
      ON CONFLICT (set_number) DO UPDATE SET bl_type=$2, is_gear=true, fetched_at=NOW()`,
      [number, art],
    );
  } else {
    await db.run(
      `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1,$2,false)
      ON CONFLICT (set_number) DO UPDATE SET bl_type=$2, is_gear=false`,
      [number, art],
    );
  }
}

export async function emptySubsetsCache(db: DbInterface, number: string | null): Promise<void> {
  if (number) await db.run('DELETE FROM subsets_cache WHERE set_number = $1', [number]);
  else await db.run('DELETE FROM subsets_cache');
}

export async function emptyCatalogCache(db: DbInterface, number: string | null): Promise<void> {
  if (number) await db.run('DELETE FROM catalog_cache WHERE set_number = $1', [number]);
  else await db.run('DELETE FROM catalog_cache');
}

/** Only the own caches; prices are counted by finances (price_cache belongs to it). */
export async function cacheNumbers(db: DbInterface): Promise<{ subsets: number; catalog: number }> {
  const count = async (table: 'subsets_cache' | 'catalog_cache') =>
    parseInt(String((await db.get<{ c: string }>(`SELECT COUNT(*) AS c FROM ${table}`))?.c ?? 0), 10);
  const [subsets, catalog] = await Promise.all([count('subsets_cache'), count('catalog_cache')]);
  return { subsets, catalog };
}

export function blTypesTheSets(db: DbInterface, setNumbers: string[]) {
  return db.all<{ set_number: string; bl_type: string | null }>(
    'SELECT set_number, bl_type FROM catalog_cache WHERE set_number = ANY($1::text[])',
    [setNumbers],
  );
}

export function rememberBlType(db: DbInterface, n: string, found: string, isGear: boolean) {
  return db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1,$2,$3)
     ON CONFLICT (set_number) DO UPDATE SET bl_type = $2, fetched_at = NOW()`,
    [n, found, isGear],
  );
}
