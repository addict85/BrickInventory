export type Schreiber = { run: (sql: string, params?: unknown[]) => Promise<unknown> };
import * as db from '../../../db/database';

export async function inventarNachKandidaten(kandidaten: string[]): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM rb_inventories WHERE set_num = ANY($1) ORDER BY version DESC LIMIT 1', [kandidaten]);
  return row ? row.id : null;
}

export async function geladeneFarben(): Promise<{ id: number; name: string; hex: string | null }[]> {
  return db.all(
    `SELECT id, name, NULLIF(rgb, '') AS hex FROM rb_colors
      WHERE id >= 0 AND name IS NOT NULL ORDER BY id`);
}

export function schreibeTeilKatalog(dbh: Schreiber, partNumber: string, name: string | null, kategorie: string | null, nameVon: number | null, kategorieVon: number | null, nameSql: string, kategorieSql: string) {
  return dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name, name_von, kategorie_von)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (part_number) DO UPDATE SET
      ${nameSql},
      ${kategorieSql},
      updated_at = NOW()`, [partNumber, name, kategorie, nameVon, kategorieVon]);
}

export function schreibeTeilFarbe(dbh: Schreiber, partNumber: string, farbe: number, name: string | null, code: string | null, bild: string | null, lokal: string | null, nameVon: number | null, codeVon: number | null, bildVon: number | null, nameSql: string, codeSql: string, bildSql: string) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local,
                                    farbname_von, farbcode_von, bild_von)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      ${nameSql},
      ${codeSql},
      ${bildSql},
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [partNumber, farbe, name, code, bild, lokal, nameVon, codeVon, bildVon]);
}

export function schreibeFigurKatalog(dbh: Schreiber, figNumber: string, name: string | null, bild: string | null, lokal: string | null, nameVon: number | null, bildVon: number | null, nameSql: string, bildSql: string) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local, name_von, bild_von)
    VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
    ON CONFLICT (fig_number) DO UPDATE SET
      ${nameSql},
      ${bildSql},
      image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [figNumber, name, bild, lokal, nameVon, bildVon]);
}

export function schreibeSetTeil(dbh: Schreiber, setNumber: string, partNumber: string, colorId: number, quantity: number, isSpare: boolean) {
  return dbh.run(`
    INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = NOW()`, [setNumber, partNumber, colorId, quantity, isSpare]);
}

export function schreibeTeileKatalog(dbh: Schreiber, nummern: string[], namen: (string | null)[], kategorien: (string | null)[], nameSql: string, kategorieSql: string) {
  return dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (part_number) DO UPDATE SET
      ${nameSql},
      ${kategorieSql},
      updated_at = NOW()`, [nummern, namen, kategorien]);
}

export function schreibeTeilFarben(dbh: Schreiber, nummern: string[], farben: number[], namen: (string | null)[], codes: (string | null)[], bilder: (string | null)[], lokale: (string | null)[], nameSql: string, codeSql: string, bildSql: string) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    SELECT p, f, n, c, u, NULLIF(l, '') FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS x(p, f, n, c, u, l)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      ${nameSql},
      ${codeSql},
      ${bildSql},
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [nummern, farben, namen, codes, bilder, lokale]);
}

export function schreibeSetTeile(dbh: Schreiber, setNumber: string, nummern: string[], farben: number[], mengen: number[], ersatz: boolean[]) {
  return dbh.run(`
    INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
    SELECT $1, p, f, q, s FROM unnest($2::text[], $3::int[], $4::int[], $5::boolean[]) AS x(p, f, q, s)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, is_spare = EXCLUDED.is_spare, updated_at = NOW()`, [setNumber, nummern, farben, mengen, ersatz]);
}

export function schreibeFigurenKatalog(dbh: Schreiber, nummern: string[], namen: (string | null)[], bilder: (string | null)[], nameSql: string, bildSql: string) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (fig_number) DO UPDATE SET
      ${nameSql},
      ${bildSql},
      updated_at  = NOW()`, [nummern, namen, bilder]);
}

export function schreibeTeilbildLokal(dbh: Schreiber, partNumber: string, colorId: number, imageLocal: string) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, image_local)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number, color_id) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`, [partNumber, colorId, imageLocal]);
}

export function schreibeSetFiguren(dbh: Schreiber, setNumber: string, nummern: string[], mengen: number[]) {
  return dbh.run(`
    INSERT INTO set_figuren (set_number, fig_number, quantity)
    SELECT $1, * FROM unnest($2::text[], $3::int[])
    ON CONFLICT (set_number, fig_number) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`, [setNumber, nummern, mengen]);
}

export function schreibeFigurBildAdresse(dbh: Schreiber, figNumber: string, imageUrl: string) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, image_url) VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE SET image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url)`, [figNumber, imageUrl]);
}

export function schreibeFigurBildLokal(dbh: Schreiber, figNumber: string, imageLocal: string) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, image_local)
    VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`, [figNumber, imageLocal]);
}

/** Eingaben eines anderen Kontos gelten nicht als Katalogwissen. */
export function teilAusKatalog(partNumber: string, colorId: number | null, fuer: number | null) {
  return db.get(`
    SELECT COALESCE(CASE WHEN pc.name_von IS NULL OR pc.name_von = $3 THEN pc.part_name END, rp.name) AS name,
           CASE WHEN pc.kategorie_von IS NULL OR pc.kategorie_von = $3 THEN pc.category_name END AS kategorie,
           rp.part_img_url                 AS bild_allgemein,
           CASE WHEN pcc.bild_von IS NULL OR pcc.bild_von = $3 THEN pcc.image_url END AS farb_url,
           pcc.image_local                 AS farb_datei
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN part_catalog       pc  ON pc.part_number  = q.nr
      LEFT JOIN rb_parts           rp  ON rp.part_num     = q.nr
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = q.nr AND pcc.color_id = $2`, [partNumber, colorId, fuer]);
}

export function figurAusKatalog(figNumber: string, fuer: number | null) {
  return db.get(`
    SELECT CASE WHEN name_von IS NULL OR name_von = $2 THEN fig_name END  AS fig_name,
           CASE WHEN bild_von IS NULL OR bild_von = $2 THEN image_url END AS image_url,
           image_local
      FROM minifigs_catalog WHERE fig_number = $1`, [figNumber, fuer]);
}
