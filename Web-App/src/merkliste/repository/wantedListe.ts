import * as db from '../../../db/database';

export type Art = 'part' | 'fig' | 'set';

/** Zuordnungen zu BrickLink-Nummern; `bl_id IS NULL` heisst „gleich vermerkt“.
 * Die eigenen des Kontos stehen vorn (`eigen`), damit sie Vorrang haben. */
export function zuordnungen(blNummern: string[], uid: number | null = null) {
  return db.all<{ art: Art; rb_id: string; bl_id: string | null; eigen: boolean }>(
    `SELECT art, rb_id, NULLIF(bl_id, rb_id) AS bl_id, true AS eigen FROM bl_zuordnung_eigen
      WHERE user_id = $2 AND bl_id = ANY($1)
     UNION ALL
     SELECT art, rb_id, bl_id, false FROM bl_zuordnung
      WHERE (bl_id = ANY($1) OR (bl_id IS NULL AND rb_id = ANY($1)))
     ORDER BY eigen DESC`, [blNummern, uid]);
}

const KATALOG: Record<Art, string> = {
  part: 'SELECT part_number AS n FROM part_catalog WHERE part_number = ANY($1)',
  fig:  'SELECT fig_number AS n FROM minifigs_catalog WHERE fig_number = ANY($1)',
  set:  'SELECT set_number AS n FROM set_catalog WHERE set_number = ANY($1)',
};

/** Welche der Nummern der eigene Katalog dieser Art führt. */
export async function nummernImKatalog(art: Art, nummern: string[]): Promise<string[]> {
  return (await db.all<{ n: string }>(KATALOG[art], [nummern])).map(z => z.n);
}

export type Farbe = { id: number; name: string | null; rgb: string | null };

export function farbenZuBlFarben(blFarben: number[]) {
  return db.all<Farbe & { bl_color_id: number }>(
    'SELECT id, name, rgb, bl_color_id FROM rb_colors WHERE bl_color_id = ANY($1)', [blFarben]);
}

export function farbenZuIds(ids: number[]) {
  return db.all<Farbe>('SELECT id, name, rgb FROM rb_colors WHERE id = ANY($1)', [ids]);
}

export function teileBeschreibung(nummern: string[]) {
  return db.all<{ part_number: string; name: string | null; bild_allgemein: string }>(`
      SELECT p.part_number,
             COALESCE(pc.part_name, rp.name)        AS name,
             COALESCE(rp.part_img_url, '')          AS bild_allgemein
        FROM (SELECT UNNEST($1::text[]) AS part_number) p
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN rb_parts     rp ON rp.part_num    = p.part_number`, [nummern]);
}

export function teilFarbbilder(nummern: string[], farbIds: number[]) {
  return db.all<{ part_number: string; color_id: number; bild: string | null }>(`
        SELECT part_number, color_id, COALESCE(image_local, image_url) AS bild
          FROM part_color_catalog
         WHERE (part_number, color_id) IN (
                 SELECT UNNEST($1::text[]), UNNEST($2::int[]))`, [nummern, farbIds]);
}

export function figurenBeschreibung(nummern: string[]) {
  return db.all<{ fig_number: string; fig_name: string | null; bild: string | null }>(
    `SELECT fig_number, fig_name, COALESCE(image_local, image_url) AS bild
         FROM minifigs_catalog WHERE fig_number = ANY($1)`, [nummern]);
}

export function setsBeschreibung(nummern: string[]) {
  return db.all<{ set_number: string; name: string | null; bild: string | null }>(`
      SELECT s.set_number,
             COALESCE(sc.name, rs.name)                                AS name,
             COALESCE(sc.image_local, sc.image_url, rs.set_img_url)     AS bild
        FROM (SELECT UNNEST($1::text[]) AS set_number) s
        LEFT JOIN set_catalog sc ON sc.set_number = s.set_number
        LEFT JOIN rb_sets     rs ON rs.set_num    = s.set_number`, [nummern]);
}
