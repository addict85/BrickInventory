/**
 * Datenzugriff auf die Zwischenspeicher des Katalogs: catalog_cache (was
 * BrickLink zu einer Nummer kennt) und subsets_cache.
 */
import * as db from '../../../db/database';

export interface KatalogEintrag { is_gear?: number | null; bl_type?: string | null; fetched_at?: string | Date | null; }

/** Unter der Schreibweise, unter der er abgelegt wird (mit Versionsnummer). */
export async function katalogEintragZu(nummer: string): Promise<KatalogEintrag | null> {
  return (await db.get<KatalogEintrag>('SELECT is_gear, bl_type, fetched_at FROM catalog_cache WHERE set_number = $1',
    [nummer])) ?? null;
}

export type BricklinkArt = 'GEAR' | 'BOOK' | 'NONE';

/** Was BrickLink zu einer Nummer führt; NONE heisst „kein Preis", mit Zeitstempel. */
export async function merkeBricklinkArt(nummer: string, art: BricklinkArt): Promise<void> {
  if (art === 'NONE') {
    await db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,1)
      ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=1, fetched_at=NOW()`, [nummer, `Set ${nummer}`, art]);
  } else {
    await db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,0)
      ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=0`, [nummer, `Set ${nummer}`, art]);
  }
}

/** Ohne Nummer den ganzen Zwischenspeicher. */
export async function leereSubsetsCache(nummer: string | null): Promise<void> {
  if (nummer) await db.run('DELETE FROM subsets_cache WHERE set_number = $1', [nummer]);
  else await db.run('DELETE FROM subsets_cache');
}

/** Ohne Nummer den ganzen Zwischenspeicher. */
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
