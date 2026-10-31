/**
 * Der Katalog aus den Rebrickable-CSV-Tabellen: Teile und Figuren eines
 * Inventars, Sets ohne Katalogeintrag, Teile ohne BrickLink-Nachsicht.
 */
import * as db from '../../../db/database';

/** Wie viele Teile eines Sets im Katalog stehen und wie viele davon ein lokales Bild haben. */
export async function katalogBildstand(setNumber: string): Promise<{ total: number; mitBild: number }> {
  const r = await db.get<{ total: string; with_img: string }>(
    `SELECT COUNT(*) AS total, COUNT(image_local) AS with_img
     FROM set_parts_catalog WHERE set_number = $1`, [setNumber]);
  return { total: parseInt(r?.total ?? '0'), mitBild: parseInt(r?.with_img ?? '0') };
}

export interface CsvTeil {
  part_number: string; bl_part_number: string; part_name: string | null; color_id: number | null;
  color_name: string | null; color_hex: string | null; image_url: string | null; quantity: number; is_spare: unknown;
}

/** Die Teile eines Inventars ohne Ersatzteile, mit BrickLink-Nummer. */
export async function inventarTeileOhneErsatz(inventarId: number): Promise<CsvTeil[]> {
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
       AND ip.is_spare = 0`, [inventarId]);
}

/** Die Minifiguren eines Inventars. */
export async function inventarFiguren(inventarId: number): Promise<{ fig_number: string; quantity: number; fig_name: string | null; image_url: string | null }[]> {
  return db.all(
    `SELECT ip.part_num AS fig_number, ip.quantity,
            s.name AS fig_name, s.set_img_url AS image_url
     FROM rb_inventory_parts ip
     LEFT JOIN rb_sets s ON s.set_num = ip.part_num
     WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`, [inventarId]);
}

/** Bis zu `grenze` Sets aus den CSV-Tabellen, die noch keinen Teilekatalog haben. */
export async function setsOhneTeilekatalog(grenze = 50): Promise<string[]> {
  const rows = await db.all<{ set_num: string }>(
    `SELECT DISTINCT s.set_num FROM rb_sets s
     LEFT JOIN set_parts_catalog c ON c.set_number = s.set_num
     WHERE c.set_number IS NULL AND s.set_num NOT LIKE 'fig-%'
     LIMIT $1`, [grenze]);
  return rows.map(r => r.set_num);
}

/** Erfasste Teile, für die noch keine BrickLink-Zuordnung nachgesehen wurde. */
export async function teileOhneBlNachsicht(): Promise<string[]> {
  const rows = await db.all<{ part_number: string }>(
    `SELECT DISTINCT p.part_number FROM parts p
      LEFT JOIN bl_zuordnung z ON z.art = 'part' AND z.rb_id = p.part_number
      WHERE z.rb_id IS NULL
      ORDER BY p.part_number`);
  return rows.map(r => r.part_number);
}

/** Manuell erfasste Teile mit echter Farbe — für das Farbbild. */
export async function manuelleFarbteile(): Promise<{ id: number; part_number: string; color_id: number }[]> {
  return db.all("SELECT id, part_number, color_id FROM parts WHERE source='manual' AND color_id IS NOT NULL AND color_id != 0 ORDER BY id ASC");
}

/** Das Bild der gewählten Farbe setzen — überschreibend, das ist der Zweck. */
export async function ersetzeTeilfarbenbild(partNumber: string, colorId: number, url: string): Promise<void> {
  await db.run(`
    INSERT INTO part_color_catalog (part_number, color_id, image_url)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number, color_id) DO UPDATE
      SET image_url = EXCLUDED.image_url, bild_von = NULL, updated_at = NOW()`, [partNumber, colorId, url]);
}
