import type { DbInterface } from '../../../db/database';

export type Art = 'part' | 'fig' | 'set';

/** Mappings to BrickLink numbers; `bl_id IS NULL` means "noted as identical".
 * The account's own ones come first (`eigen`), so that they take precedence. */
export function mappings(db: DbInterface, blNumbers: string[], uid: number | null = null) {
  return db.all<{ type: Art; rb_id: string; bl_id: string | null; eigen: boolean }>(
    `SELECT type, rb_id, NULLIF(bl_id, rb_id) AS bl_id, true AS eigen FROM bl_mapping_custom
      WHERE user_id = $2 AND bl_id = ANY($1)
     UNION ALL
     SELECT type, rb_id, bl_id, false FROM bl_mapping
      WHERE (bl_id = ANY($1) OR (bl_id IS NULL AND rb_id = ANY($1)))
     ORDER BY eigen DESC`,
    [blNumbers, uid],
  );
}

const CATALOG: Record<Art, string> = {
  part: 'SELECT part_number AS n FROM part_catalog WHERE part_number = ANY($1)',
  fig: 'SELECT fig_number AS n FROM minifigs_catalog WHERE fig_number = ANY($1)',
  set: 'SELECT set_number AS n FROM set_catalog WHERE set_number = ANY($1)',
};

/** Which of the numbers the own catalog of this kind lists. */
export async function numbersInCatalog(db: DbInterface, kind: Art, numbers: string[]): Promise<string[]> {
  return (await db.all<{ n: string }>(CATALOG[kind], [numbers])).map(z => z.n);
}

export type Color = { id: number; name: string | null; rgb: string | null };

export function colorsToBlColors(db: DbInterface, blColors: number[]) {
  return db.all<Color & { bl_color_id: number }>(
    'SELECT id, name, rgb, bl_color_id FROM rb_colors WHERE bl_color_id = ANY($1)',
    [blColors],
  );
}

export function colorsToIds(db: DbInterface, ids: number[]) {
  return db.all<Color>('SELECT id, name, rgb FROM rb_colors WHERE id = ANY($1)', [ids]);
}

export function partsDescription(db: DbInterface, numbers: string[]) {
  return db.all<{ part_number: string; name: string | null; bild_allgemein: string }>(
    `
      SELECT p.part_number,
             COALESCE(pc.part_name, rp.name)        AS name,
             COALESCE(rp.part_img_url, '')          AS bild_allgemein
        FROM (SELECT UNNEST($1::text[]) AS part_number) p
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN rb_parts     rp ON rp.part_num    = p.part_number`,
    [numbers],
  );
}

export function partColorImages(db: DbInterface, numbers: string[], colorIds: number[]) {
  return db.all<{ part_number: string; color_id: number; image: string | null }>(
    `
        SELECT part_number, color_id, COALESCE(image_local, image_url) AS image
          FROM part_color_catalog
         WHERE (part_number, color_id) IN (
                 SELECT UNNEST($1::text[]), UNNEST($2::int[]))`,
    [numbers, colorIds],
  );
}

export function minifigsDescription(db: DbInterface, numbers: string[]) {
  return db.all<{ fig_number: string; fig_name: string | null; image: string | null }>(
    `SELECT fig_number, fig_name, COALESCE(image_local, image_url) AS image
         FROM minifigs_catalog WHERE fig_number = ANY($1)`,
    [numbers],
  );
}

export function setsDescription(db: DbInterface, numbers: string[]) {
  return db.all<{ set_number: string; name: string | null; image: string | null }>(
    `
      SELECT s.set_number,
             rs.name                                                   AS name,
             COALESCE(sc.image_local, sc.image_url)                     AS image
        FROM (SELECT UNNEST($1::text[]) AS set_number) s
        LEFT JOIN set_catalog sc ON sc.set_number = s.set_number
        LEFT JOIN rb_sets     rs ON rs.set_num    = s.set_number`,
    [numbers],
  );
}
