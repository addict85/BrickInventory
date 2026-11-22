import type { DbInterface } from '../../../db/database';
export type Writer = { run: (sql: string, params?: unknown[]) => Promise<unknown> };

export async function inventoryAfterCandidates(db: DbInterface, candidates: string[]): Promise<number | null> {
  const row = await db.get<{ id: number }>(
    'SELECT id FROM rb_inventories WHERE set_num = ANY($1) ORDER BY version DESC LIMIT 1',
    [candidates],
  );
  return row ? row.id : null;
}

export async function loadedColors(db: DbInterface): Promise<{ id: number; name: string; hex: string | null }[]> {
  return db.all<{ id: number; name: string; hex: string | null }>(
    `SELECT id, name, NULLIF(rgb, '') AS hex FROM rb_colors
      WHERE id >= 0 AND name IS NOT NULL ORDER BY id`,
  );
}

// The shared catalog keeps the first verified value; COALESCE holds it against later sources.
export function writePartCatalog(dbh: Writer, partNumber: string, name: string | null, category: string | null) {
  return dbh.run(
    `
    INSERT INTO part_catalog (part_number, part_name, category_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number) DO UPDATE SET
      part_name = COALESCE(part_catalog.part_name, EXCLUDED.part_name),
      category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name),
      updated_at = NOW()`,
    [partNumber, name, category],
  );
}

export function writePartColor(
  dbh: Writer,
  partNumber: string,
  color: number,
  name: string | null,
  code: string | null,
  image: string | null,
  local: string | null,
) {
  return dbh.run(
    `
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      color_name = COALESCE(part_color_catalog.color_name, EXCLUDED.color_name),
      color_hex = COALESCE(part_color_catalog.color_hex, EXCLUDED.color_hex),
      image_url = COALESCE(part_color_catalog.image_url, EXCLUDED.image_url),
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [partNumber, color, name, code, image, local],
  );
}

export function writeMinifigCatalog(
  dbh: Writer,
  figNumber: string,
  name: string | null,
  image: string | null,
  local: string | null,
) {
  return dbh.run(
    `
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local)
    VALUES ($1, $2, $3, NULLIF($4, ''))
    ON CONFLICT (fig_number) DO UPDATE SET
      fig_name = COALESCE(minifigs_catalog.fig_name, EXCLUDED.fig_name),
      image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url),
      image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [figNumber, name, image, local],
  );
}

/** Own details: the newest input applies, an empty field leaves the old one standing. */
export function writePartOwn(
  dbh: Writer,
  uid: number,
  partNumber: string,
  name: string | null,
  category: string | null,
) {
  if (name === null && category === null) return Promise.resolve();
  return dbh.run(
    `
    INSERT INTO part_custom (user_id, part_number, part_name, category_name) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, part_number) DO UPDATE SET
      part_name     = COALESCE(EXCLUDED.part_name, part_custom.part_name),
      category_name = COALESCE(EXCLUDED.category_name, part_custom.category_name),
      updated_at    = NOW()`,
    [uid, partNumber, name, category],
  );
}

export function writePartColorOwn(
  dbh: Writer,
  uid: number,
  partNumber: string,
  color: number,
  name: string | null,
  code: string | null,
  image: string | null,
) {
  if (name === null && code === null && image === null) return Promise.resolve();
  return dbh.run(
    `
    INSERT INTO part_color_custom (user_id, part_number, color_id, color_name, color_hex, image_url) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, part_number, color_id) DO UPDATE SET
      color_name = COALESCE(EXCLUDED.color_name, part_color_custom.color_name),
      color_hex  = COALESCE(EXCLUDED.color_hex, part_color_custom.color_hex),
      image_url  = COALESCE(EXCLUDED.image_url, part_color_custom.image_url),
      updated_at = NOW()`,
    [uid, partNumber, color, name, code, image],
  );
}

export function writeMinifigOwn(
  dbh: Writer,
  uid: number,
  figNumber: string,
  name: string | null,
  image: string | null,
) {
  if (name === null && image === null) return Promise.resolve();
  return dbh.run(
    `
    INSERT INTO minifig_custom (user_id, fig_number, fig_name, image_url) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, fig_number) DO UPDATE SET
      fig_name   = COALESCE(EXCLUDED.fig_name, minifig_custom.fig_name),
      image_url  = COALESCE(EXCLUDED.image_url, minifig_custom.image_url),
      updated_at = NOW()`,
    [uid, figNumber, name, image],
  );
}

export function writeSetPart(
  dbh: Writer,
  setNumber: string,
  partNumber: string,
  colorId: number,
  quantity: number,
  isSpare: boolean,
) {
  return dbh.run(
    `
    INSERT INTO set_parts (set_number, part_number, color_id, quantity, is_spare)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
    [setNumber, partNumber, colorId, quantity, isSpare],
  );
}

export function writePartsCatalog(
  dbh: Writer,
  numbers: string[],
  names: (string | null)[],
  categories: (string | null)[],
) {
  return dbh.run(
    `
    INSERT INTO part_catalog (part_number, part_name, category_name)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (part_number) DO UPDATE SET
      part_name = COALESCE(part_catalog.part_name, EXCLUDED.part_name),
      category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name),
      updated_at = NOW()`,
    [numbers, names, categories],
  );
}

export function writePartColors(
  dbh: Writer,
  numbers: string[],
  colors: number[],
  names: (string | null)[],
  codes: (string | null)[],
  bilder: (string | null)[],
  local: (string | null)[],
) {
  return dbh.run(
    `
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    SELECT p, f, n, c, u, NULLIF(l, '') FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS x(p, f, n, c, u, l)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      color_name = COALESCE(part_color_catalog.color_name, EXCLUDED.color_name),
      color_hex = COALESCE(part_color_catalog.color_hex, EXCLUDED.color_hex),
      image_url = COALESCE(part_color_catalog.image_url, EXCLUDED.image_url),
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`,
    [numbers, colors, names, codes, bilder, local],
  );
}

export function writeSetParts(
  dbh: Writer,
  setNumber: string,
  numbers: string[],
  colors: number[],
  quantities: number[],
  ersatz: boolean[],
) {
  return dbh.run(
    `
    INSERT INTO set_parts (set_number, part_number, color_id, quantity, is_spare)
    SELECT $1, p, f, q, s FROM unnest($2::text[], $3::int[], $4::int[], $5::boolean[]) AS x(p, f, q, s)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, is_spare = EXCLUDED.is_spare, updated_at = NOW()`,
    [setNumber, numbers, colors, quantities, ersatz],
  );
}

export function writeMinifigsCatalog(
  dbh: Writer,
  numbers: string[],
  names: (string | null)[],
  bilder: (string | null)[],
) {
  return dbh.run(
    `
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (fig_number) DO UPDATE SET
      fig_name = COALESCE(minifigs_catalog.fig_name, EXCLUDED.fig_name),
      image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url),
      updated_at  = NOW()`,
    [numbers, names, bilder],
  );
}

export function writePartImageLocal(dbh: Writer, partNumber: string, colorId: number, imageLocal: string) {
  return dbh.run(
    `
    INSERT INTO part_color_catalog (part_number, color_id, image_local)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number, color_id) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`,
    [partNumber, colorId, imageLocal],
  );
}

export function writeSetMinifigs(dbh: Writer, setNumber: string, numbers: string[], quantities: number[]) {
  return dbh.run(
    `
    INSERT INTO set_minifigs (set_number, fig_number, quantity)
    SELECT $1, * FROM unnest($2::text[], $3::int[])
    ON CONFLICT (set_number, fig_number) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
    [setNumber, numbers, quantities],
  );
}

export function writeMinifigImageAddress(dbh: Writer, figNumber: string, imageUrl: string) {
  return dbh.run(
    `
    INSERT INTO minifigs_catalog (fig_number, image_url) VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE SET image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url)`,
    [figNumber, imageUrl],
  );
}

export function writeMinifigImageLocal(dbh: Writer, figNumber: string, imageLocal: string) {
  return dbh.run(
    `
    INSERT INTO minifigs_catalog (fig_number, image_local)
    VALUES ($1, $2)
    ON CONFLICT (fig_number) DO UPDATE
      SET image_local = EXCLUDED.image_local, updated_at = NOW()`,
    [figNumber, imageLocal],
  );
}

/** The verified value, otherwise `fuer`'s own detail; others' inputs are not in the catalog. */
export function partFromCatalog(db: DbInterface, partNumber: string, colorId: number | null, forUser: number | null) {
  return db.get<{
    name: string | null;
    kategorie: string | null;
    bild_allgemein: string | null;
    farb_url: string | null;
    farb_datei: string | null;
  }>(
    `
    SELECT COALESCE(pc.part_name, rp.name, te.part_name)   AS name,
           COALESCE(pc.category_name, te.category_name)     AS kategorie,
           rp.part_img_url                                  AS bild_allgemein,
           COALESCE(pcc.image_url, tfe.image_url)           AS farb_url,
           pcc.image_local                                  AS farb_datei
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN part_catalog       pc  ON pc.part_number  = q.nr
      LEFT JOIN rb_parts           rp  ON rp.part_num     = q.nr
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = q.nr AND pcc.color_id = $2
      LEFT JOIN part_custom         te  ON te.user_id = $3 AND te.part_number = q.nr
      LEFT JOIN part_color_custom   tfe ON tfe.user_id = $3 AND tfe.part_number = q.nr AND tfe.color_id = $2`,
    [partNumber, colorId, forUser],
  );
}

export function minifigFromCatalog(db: DbInterface, figNumber: string, forUser: number | null) {
  return db.get<{ fig_name: string | null; image_url: string | null; image_local: string | null }>(
    `
    SELECT COALESCE(mc.fig_name, fe.fig_name)   AS fig_name,
           COALESCE(mc.image_url, fe.image_url) AS image_url,
           mc.image_local
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN minifigs_catalog mc ON mc.fig_number = q.nr
      LEFT JOIN minifig_custom fe ON fe.user_id = $2 AND fe.fig_number = q.nr
     WHERE mc.fig_number IS NOT NULL OR fe.fig_number IS NOT NULL`,
    [figNumber, forUser],
  );
}
