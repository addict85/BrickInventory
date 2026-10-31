/**
 * Was von Rebrickable gelesen und hier abgelegt wird: Set-Stammdaten
 * (catalog_cache), Teilelisten (subsets_cache), Figurenteile
 * (minifig_parts_cache) und die Teileliste eines Inventars aus den CSV-Tabellen.
 */
import * as db from '../../../db/database';

export interface KatalogSet {
  set_number: string; name: string | null; year: number | null; theme: string | null;
  pieces: number | null; image_url: string | null; is_gear: number; fetched_at?: string | Date | null;
}

export async function katalogSetZu(nummer: string): Promise<KatalogSet | undefined> {
  return db.get<KatalogSet>('SELECT * FROM catalog_cache WHERE set_number = $1', [nummer]);
}

/** Rebrickable kennt die Nummer nicht: Platzhalter merken, damit höchstens täglich nachgefragt wird. */
export async function merkeUnbekanntesSet(nummer: string, alsGear: boolean): Promise<void> {
  await db.run(`INSERT INTO catalog_cache (set_number, name, is_gear) VALUES ($1,$2,$3)
    ON CONFLICT (set_number) DO UPDATE SET is_gear=$3, fetched_at=NOW()`, [nummer, `Set ${nummer}`, alsGear ? 1 : 0]);
}

export async function merkeSet(s: Omit<KatalogSet, 'is_gear' | 'fetched_at'>): Promise<void> {
  await db.run(`INSERT INTO catalog_cache (set_number,name,year,theme,pieces,image_url,is_gear) VALUES ($1,$2,$3,$4,$5,$6,0)
    ON CONFLICT (set_number) DO UPDATE SET name=$2,year=$3,theme=$4,pieces=$5,image_url=$6,is_gear=0`,
    [s.set_number, s.name, s.year, s.theme, s.pieces, s.image_url]);
}

/** Die abgelegte Teileliste eines Sets (JSON), oder undefined. */
export async function teilelisteAusCache(nummer: string): Promise<string | undefined> {
  return (await db.get<{ data: string }>('SELECT data FROM subsets_cache WHERE set_number = $1', [nummer]))?.data;
}

export async function merkeTeileliste(nummer: string, json: string): Promise<void> {
  await db.run(`INSERT INTO subsets_cache (set_number, data) VALUES ($1,$2)
    ON CONFLICT (set_number) DO UPDATE SET data=$2, fetched_at=NOW()`, [nummer, json]);
}

export async function figurenteileAusCache(figur: string): Promise<string | undefined> {
  return (await db.get<{ data: string }>('SELECT data FROM minifig_parts_cache WHERE fig_number = $1', [figur]))?.data;
}

export async function merkeFigurenteile(figur: string, json: string): Promise<void> {
  await db.run(`INSERT INTO minifig_parts_cache (fig_number, data, fetched_at) VALUES ($1,$2,NOW())
    ON CONFLICT (fig_number) DO UPDATE SET data=$2, fetched_at=NOW()`, [figur, json]);
}

export interface InventarTeil {
  part_num: string; color_id: number; quantity: number; is_spare: unknown; img_url: string | null;
  name: string | null; part_img_url: string | null; color_name: string | null; color_rgb: string | null;
  bl_part_num: string | null;
}

/** Die Teile eines Inventars aus den Rebrickable-CSV-Tabellen, mit Farbe und BrickLink-Nummer. */
export async function inventarTeile(inventarId: number): Promise<InventarTeil[]> {
  return db.all<InventarTeil>(
    `SELECT ip.part_num, ip.color_id, ip.quantity, ip.is_spare, ip.img_url,
            p.name, p.part_img_url,
            c.name as color_name, c.rgb as color_rgb,
            m.bl_id AS bl_part_num
     FROM rb_inventory_parts ip
     LEFT JOIN rb_parts p ON p.part_num = ip.part_num
     LEFT JOIN rb_colors c ON c.id = ip.color_id
     LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
     WHERE ip.inventory_id = $1`, [inventarId]);
}
