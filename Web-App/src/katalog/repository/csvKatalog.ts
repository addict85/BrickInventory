import type { DbSchnittstelle } from '../../../db/database';

export async function katalogBildstand(db: DbSchnittstelle, setNumber: string): Promise<{ total: number; mitBild: number }> {
  const r = await db.get<{ total: string; with_img: string }>(
    `SELECT COUNT(*) AS total, COUNT(image_local) AS with_img
     FROM set_parts_catalog WHERE set_number = $1`, [setNumber]);
  return { total: parseInt(r?.total ?? '0'), mitBild: parseInt(r?.with_img ?? '0') };
}

export interface CsvTeil {
  part_number: string; bl_part_number: string; part_name: string | null; color_id: number | null;
  color_name: string | null; color_hex: string | null; image_url: string | null; quantity: number; is_spare: boolean;
}

export async function inventarTeileOhneErsatz(db: DbSchnittstelle, inventarId: number): Promise<CsvTeil[]> {
  return db.all<CsvTeil>(
    `SELECT ip.part_num AS part_number,
            COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
            p.name AS part_name, ip.color_id,
            c.name AS color_name, c.rgb AS color_hex,
            COALESCE(NULLIF(p.part_img_url, '')) AS image_url,
            ip.quantity, ip.is_spare
     FROM rb_inventory_parts ip
     LEFT JOIN rb_parts p ON p.part_num = ip.part_num
     LEFT JOIN rb_colors c ON c.id = ip.color_id
     LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
     WHERE ip.inventory_id = $1
       AND NOT ip.is_spare`, [inventarId]);
}

export async function inventarFiguren(db: DbSchnittstelle, inventarId: number): Promise<{ fig_number: string; quantity: number; fig_name: string | null; image_url: string | null }[]> {
  return db.all(
    `SELECT ip.part_num AS fig_number, ip.quantity,
            s.name AS fig_name, s.set_img_url AS image_url
     FROM rb_inventory_parts ip
     LEFT JOIN rb_sets s ON s.set_num = ip.part_num
     WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`, [inventarId]);
}

export async function setsOhneTeilekatalog(db: DbSchnittstelle, grenze = 50): Promise<string[]> {
  const rows = await db.all<{ set_num: string }>(
    `SELECT DISTINCT s.set_num FROM rb_sets s
     LEFT JOIN set_parts_catalog c ON c.set_number = s.set_num
     WHERE c.set_number IS NULL AND s.set_num NOT LIKE 'fig-%'
     LIMIT $1`, [grenze]);
  return rows.map(r => r.set_num);
}

export async function manuelleFarbteile(db: DbSchnittstelle): Promise<{ id: number; part_number: string; color_id: number }[]> {
  return db.all("SELECT id, part_number, color_id FROM parts WHERE source='manual' AND color_id IS NOT NULL AND color_id != 0 ORDER BY id ASC");
}

/** Überschreibend — das ist der Zweck. */
export async function ersetzeTeilfarbenbild(db: DbSchnittstelle, partNumber: string, colorId: number, url: string): Promise<void> {
  await db.run(`
    INSERT INTO part_color_catalog (part_number, color_id, image_url)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number, color_id) DO UPDATE
      SET image_url = EXCLUDED.image_url, updated_at = NOW()`, [partNumber, colorId, url]);
}
