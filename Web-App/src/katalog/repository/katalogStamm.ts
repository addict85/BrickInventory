/** Was zum Schreiben in den Katalog genügt: die Verbindung oder eine Transaktion. */
export type Schreiber = { run: (sql: string, params?: unknown[]) => Promise<unknown> };
/** Stammdaten aus den Rebrickable-CSV-Tabellen: Inventare und Farben. */
import * as db from '../../../db/database';

/** Das neueste Inventar zu einer der Schreibweisen, oder null. */
export async function inventarNachKandidaten(kandidaten: string[]): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM rb_inventories WHERE set_num = ANY($1) ORDER BY version DESC LIMIT 1', [kandidaten]);
  return row ? row.id : null;
}

/** Die geladene Farbtabelle (ohne „keine Farbe“ und ohne Namenlose). */
export async function geladeneFarben(): Promise<{ id: number; name: string; hex: string | null }[]> {
  return db.all(
    `SELECT id, name, NULLIF(rgb, '') AS hex FROM rb_colors
      WHERE id >= 0 AND name IS NOT NULL ORDER BY id`);
}

export function schreibeTeilKatalog(dbh: Schreiber, partNumber: string, name: unknown, kategorie: unknown, nameVon: unknown, kategorieVon: unknown, teil1: string | number, teil2: string | number) {
  return dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name, name_von, kategorie_von)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (part_number) DO UPDATE SET
      ${teil1},
      ${teil2},
      updated_at = NOW()`, [partNumber, name, kategorie, nameVon, kategorieVon]);
}

export function schreibeTeilFarbe(dbh: Schreiber, partNumber: string, farbe: unknown, name: unknown, code: unknown, bild: unknown, wert6: unknown, wert7: unknown, wert8: unknown, wert9: unknown, teil1: string | number, teil2: string | number, teil3: string | number) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local,
                                    farbname_von, farbcode_von, bild_von)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      ${teil1},
      ${teil2},
      ${teil3},
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [partNumber, farbe, name, code, bild, wert6, wert7, wert8, wert9]);
}

export function schreibeFigurKatalog(dbh: Schreiber, figNumber: string, name: unknown, bild: unknown, wert4: unknown, wert5: unknown, wert6: unknown, teil1: string | number, teil2: string | number) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local, name_von, bild_von)
    VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
    ON CONFLICT (fig_number) DO UPDATE SET
      ${teil1},
      ${teil2},
      image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [figNumber, name, bild, wert4, wert5, wert6]);
}

export function schreibeSetTeil(dbh: Schreiber, setNumber: string, partNumber: string, colorId: number, quantity: number, isSpare: boolean) {
  return dbh.run(`
    INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = NOW()`, [setNumber, partNumber, colorId, quantity, isSpare]);
}

export function schreibeTeileKatalog(dbh: Schreiber, wert1: unknown, wert2: unknown, wert3: unknown, teil1: string | number, teil2: string | number) {
  return dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (part_number) DO UPDATE SET
      ${teil1},
      ${teil2},
      updated_at = NOW()`, [wert1, wert2, wert3]);
}

export function schreibeTeilFarben(dbh: Schreiber, wert1: unknown, wert2: unknown, wert3: unknown, wert4: unknown, wert5: unknown, wert6: unknown, teil1: string | number, teil2: string | number, teil3: string | number) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    SELECT p, f, n, c, u, NULLIF(l, '') FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS x(p, f, n, c, u, l)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      ${teil1},
      ${teil2},
      ${teil3},
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [wert1, wert2, wert3, wert4, wert5, wert6]);
}

export function schreibeSetTeile(dbh: Schreiber, setNumber: string, wert2: unknown, wert3: unknown, wert4: unknown, wert5: unknown) {
  return dbh.run(`
    INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
    SELECT $1, p, f, q, s FROM unnest($2::text[], $3::int[], $4::int[], $5::boolean[]) AS x(p, f, q, s)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, is_spare = EXCLUDED.is_spare, updated_at = NOW()`, [setNumber, wert2, wert3, wert4, wert5]);
}

export function schreibeFigurenKatalog(dbh: Schreiber, wert1: unknown, wert2: unknown, wert3: unknown, teil1: string | number, teil2: string | number) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (fig_number) DO UPDATE SET
      ${teil1},
      ${teil2},
      updated_at  = NOW()`, [wert1, wert2, wert3]);
}

export function schreibeTeilbildLokal(dbh: Schreiber, partNumber: string, colorId: unknown, imageLocal: unknown) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, image_local)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number, color_id) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`, [partNumber, colorId, imageLocal]);
}

export function schreibeSetFiguren(dbh: Schreiber, setNumber: string, wert2: unknown, wert3: unknown) {
  return dbh.run(`
    INSERT INTO set_figuren (set_number, fig_number, quantity)
    SELECT $1, * FROM unnest($2::text[], $3::int[])
    ON CONFLICT (set_number, fig_number) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`, [setNumber, wert2, wert3]);
}

export function schreibeFigurBildAdresse(dbh: Schreiber, figNumber: string, imageUrl: unknown) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, image_url) VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE SET image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url)`, [figNumber, imageUrl]);
}

export function schreibeFigurBildLokal(dbh: Schreiber, figNumber: string, imageLocal: unknown) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, image_local)
    VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`, [figNumber, imageLocal]);
}

/** Eingaben eines anderen Kontos gelten nicht als Katalogwissen. */
export function teilAusKatalog(partNumber: string, colorId: number | null, fuer: unknown) {
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

export function figurAusKatalog(figNumber: string, fuer: unknown) {
  return db.get(`
    SELECT CASE WHEN name_von IS NULL OR name_von = $2 THEN fig_name END  AS fig_name,
           CASE WHEN bild_von IS NULL OR bild_von = $2 THEN image_url END AS image_url,
           image_local
      FROM minifigs_catalog WHERE fig_number = $1`, [figNumber, fuer]);
}
