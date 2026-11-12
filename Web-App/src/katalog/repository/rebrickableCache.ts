import type { DbSchnittstelle } from '../../../db/database';
import { merkeSetKatalog } from './setStamm';

export interface KatalogSet {
  set_number: string;
  name: string | null;
  year: number | null;
  theme: string | null;
  pieces: number | null;
  image_url: string | null;
  is_gear: boolean;
  fetched_at?: string | Date | null;
}

/** Der Abrufstand aus catalog_cache, die Angaben aus rb_sets und set_catalog (0108). */
export async function katalogSetZu(db: DbSchnittstelle, nummer: string): Promise<KatalogSet | undefined> {
  return db.get<KatalogSet>(
    `SELECT cc.set_number, rs.name, NULLIF(rs.year, 0) AS year, rt.name AS theme,
           NULLIF(rs.num_parts, 0) AS pieces, sc.image_url, cc.is_gear, cc.fetched_at
      FROM catalog_cache cc
      LEFT JOIN rb_sets rs ON rs.set_num = cc.set_number
      LEFT JOIN rb_themes rt ON rt.id = rs.theme_id
      LEFT JOIN set_catalog sc ON sc.set_number = cc.set_number
     WHERE cc.set_number = $1`,
    [nummer],
  );
}

/** Damit höchstens täglich nachgefragt wird. */
export async function merkeUnbekanntesSet(db: DbSchnittstelle, nummer: string, alsGear: boolean): Promise<void> {
  await db.run(
    `INSERT INTO catalog_cache (set_number, is_gear) VALUES ($1,$2)
    ON CONFLICT (set_number) DO UPDATE SET is_gear=$2, fetched_at=NOW()`,
    [nummer, alsGear],
  );
}

/** Angaben in den Katalog, der Abrufstand in catalog_cache. */
export async function merkeSet(
  db: DbSchnittstelle,
  s: Omit<KatalogSet, 'is_gear' | 'fetched_at'> & { theme_id: number | null },
): Promise<void> {
  await merkeSetKatalog(db, s.set_number, s.name, s.year, s.theme, s.pieces, null, s.image_url, null, s.theme_id);
  await db.run(
    `INSERT INTO catalog_cache (set_number, is_gear) VALUES ($1,false)
    ON CONFLICT (set_number) DO UPDATE SET is_gear=false, fetched_at=NOW()`,
    [s.set_number],
  );
}

export async function teilelisteAusCache(db: DbSchnittstelle, nummer: string): Promise<string | undefined> {
  return (await db.get<{ data: string }>('SELECT data FROM subsets_cache WHERE set_number = $1', [nummer]))?.data;
}

export async function merkeTeileliste(db: DbSchnittstelle, nummer: string, json: string): Promise<void> {
  await db.run(
    `INSERT INTO subsets_cache (set_number, data) VALUES ($1,$2)
    ON CONFLICT (set_number) DO UPDATE SET data=$2, fetched_at=NOW()`,
    [nummer, json],
  );
}

export async function figurenteileAusCache(db: DbSchnittstelle, figur: string): Promise<string | undefined> {
  return (await db.get<{ data: string }>('SELECT data FROM minifig_parts_cache WHERE fig_number = $1', [figur]))?.data;
}

export async function merkeFigurenteile(db: DbSchnittstelle, figur: string, json: string): Promise<void> {
  await db.run(
    `INSERT INTO minifig_parts_cache (fig_number, data, fetched_at) VALUES ($1,$2,NOW())
    ON CONFLICT (fig_number) DO UPDATE SET data=$2, fetched_at=NOW()`,
    [figur, json],
  );
}

export interface InventarTeil {
  part_num: string;
  color_id: number;
  quantity: number;
  is_spare: boolean;
  img_url: string | null;
  name: string | null;
  part_img_url: string | null;
  color_name: string | null;
  color_rgb: string | null;
  bl_part_num: string | null;
}

export async function inventarTeile(db: DbSchnittstelle, inventarId: number): Promise<InventarTeil[]> {
  return db.all<InventarTeil>(
    `SELECT ip.part_num, ip.color_id, ip.quantity, ip.is_spare, ip.img_url,
            p.name, p.part_img_url,
            c.name as color_name, c.rgb as color_rgb,
            m.bl_id AS bl_part_num
     FROM rb_inventory_parts ip
     LEFT JOIN rb_parts p ON p.part_num = ip.part_num
     LEFT JOIN rb_colors c ON c.id = ip.color_id
     LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
     WHERE ip.inventory_id = $1`,
    [inventarId],
  );
}
