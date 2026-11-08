import * as db from '../../../db/database';

export interface KatalogEintrag { is_gear?: boolean | null; bl_type?: string | null; fetched_at?: string | Date | null; }

/** Mit Versionsanhang, wie er abgelegt wird. */
export async function katalogEintragZu(nummer: string): Promise<KatalogEintrag | null> {
  return (await db.get<KatalogEintrag>('SELECT is_gear, bl_type, fetched_at FROM catalog_cache WHERE set_number = $1',
    [nummer])) ?? null;
}

/** Ein Set, das einer unserer Kataloge wirklich kennt. Eine „kein Preis"-Markierung
 * zählt nicht: Sie entsteht erst durch den Abruf, den diese Prüfung verhindern soll. */
export async function setImKatalog(nummer: string): Promise<boolean> {
  const r = await db.get<{ x: number }>(
    `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM set_catalog WHERE set_number = $1)
                      OR EXISTS (SELECT 1 FROM rb_sets WHERE set_num = $1)
                      OR EXISTS (SELECT 1 FROM catalog_cache WHERE set_number = $1
                                  AND NOT (is_gear IS TRUE AND bl_type = 'NONE'))`, [nummer]);
  return !!r;
}

export type BricklinkArt = 'GEAR' | 'BOOK' | 'NONE';

/** NONE heisst „kein Preis", mit Zeitstempel. */
export async function merkeBricklinkArt(nummer: string, art: BricklinkArt): Promise<void> {
  if (art === 'NONE') {
    await db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,true)
      ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=true, fetched_at=NOW()`, [nummer, `Set ${nummer}`, art]);
  } else {
    await db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,false)
      ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=false`, [nummer, `Set ${nummer}`, art]);
  }
}

export async function leereSubsetsCache(nummer: string | null): Promise<void> {
  if (nummer) await db.run('DELETE FROM subsets_cache WHERE set_number = $1', [nummer]);
  else await db.run('DELETE FROM subsets_cache');
}

export async function leereKatalogCache(nummer: string | null): Promise<void> {
  if (nummer) await db.run('DELETE FROM catalog_cache WHERE set_number = $1', [nummer]);
  else await db.run('DELETE FROM catalog_cache');
}

export async function cacheZahlen(): Promise<{ subsets: number; catalog: number; prices: number }> {
  const zaehle = async (tabelle: 'subsets_cache' | 'catalog_cache' | 'price_cache') =>
    parseInt(String((await db.get<{ c: string }>(`SELECT COUNT(*) AS c FROM ${tabelle}`))?.c ?? 0));
  const [subsets, catalog, prices] = await Promise.all([zaehle('subsets_cache'), zaehle('catalog_cache'), zaehle('price_cache')]);
  return { subsets, catalog, prices };
}

export function blTypenDerSets(setNummern: string[]) {
  return db.all<{ set_number: string; bl_type: string | null }>('SELECT set_number, bl_type FROM catalog_cache WHERE set_number = ANY($1::text[])', [setNummern]);
}

export function merkeBlTyp(n: string, name: string, found: string, isGear: boolean) {
  return db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,$4)
     ON CONFLICT (set_number) DO UPDATE SET bl_type = $3, fetched_at = NOW()`, [n, name, found, isGear]);
}
