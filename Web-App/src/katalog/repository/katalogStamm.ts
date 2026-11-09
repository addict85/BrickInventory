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

// Im gemeinsamen Katalog bleibt der erste geprüfte Wert; COALESCE hält ihn gegen spätere Quellen.
export function schreibeTeilKatalog(dbh: Schreiber, partNumber: string, name: string | null, kategorie: string | null) {
  return dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (part_number) DO UPDATE SET
      part_name = COALESCE(part_catalog.part_name, EXCLUDED.part_name),
      category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name),
      updated_at = NOW()`, [partNumber, name, kategorie]);
}

export function schreibeTeilFarbe(dbh: Schreiber, partNumber: string, farbe: number, name: string | null, code: string | null, bild: string | null, lokal: string | null) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      color_name = COALESCE(part_color_catalog.color_name, EXCLUDED.color_name),
      color_hex = COALESCE(part_color_catalog.color_hex, EXCLUDED.color_hex),
      image_url = COALESCE(part_color_catalog.image_url, EXCLUDED.image_url),
      image_local = COALESCE(part_color_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [partNumber, farbe, name, code, bild, lokal]);
}

export function schreibeFigurKatalog(dbh: Schreiber, figNumber: string, name: string | null, bild: string | null, lokal: string | null) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url, image_local)
    VALUES ($1, $2, $3, NULLIF($4, ''))
    ON CONFLICT (fig_number) DO UPDATE SET
      fig_name = COALESCE(minifigs_catalog.fig_name, EXCLUDED.fig_name),
      image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url),
      image_local = COALESCE(minifigs_catalog.image_local, EXCLUDED.image_local),
      updated_at  = NOW()`, [figNumber, name, bild, lokal]);
}

/** Eigene Angaben: Die neueste Eingabe gilt, ein leeres Feld lässt die alte stehen. */
export function schreibeTeilEigen(dbh: Schreiber, uid: number, partNumber: string, name: string | null, kategorie: string | null) {
  if (name === null && kategorie === null) return Promise.resolve();
  return dbh.run(`
    INSERT INTO teil_eigen (user_id, part_number, part_name, category_name) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, part_number) DO UPDATE SET
      part_name     = COALESCE(EXCLUDED.part_name, teil_eigen.part_name),
      category_name = COALESCE(EXCLUDED.category_name, teil_eigen.category_name),
      updated_at    = NOW()`, [uid, partNumber, name, kategorie]);
}

export function schreibeTeilFarbeEigen(dbh: Schreiber, uid: number, partNumber: string, farbe: number, name: string | null, code: string | null, bild: string | null) {
  if (name === null && code === null && bild === null) return Promise.resolve();
  return dbh.run(`
    INSERT INTO teil_farbe_eigen (user_id, part_number, color_id, color_name, color_hex, image_url) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, part_number, color_id) DO UPDATE SET
      color_name = COALESCE(EXCLUDED.color_name, teil_farbe_eigen.color_name),
      color_hex  = COALESCE(EXCLUDED.color_hex, teil_farbe_eigen.color_hex),
      image_url  = COALESCE(EXCLUDED.image_url, teil_farbe_eigen.image_url),
      updated_at = NOW()`, [uid, partNumber, farbe, name, code, bild]);
}

export function schreibeFigurEigen(dbh: Schreiber, uid: number, figNumber: string, name: string | null, bild: string | null) {
  if (name === null && bild === null) return Promise.resolve();
  return dbh.run(`
    INSERT INTO figur_eigen (user_id, fig_number, fig_name, image_url) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, fig_number) DO UPDATE SET
      fig_name   = COALESCE(EXCLUDED.fig_name, figur_eigen.fig_name),
      image_url  = COALESCE(EXCLUDED.image_url, figur_eigen.image_url),
      updated_at = NOW()`, [uid, figNumber, name, bild]);
}

export function schreibeSetTeil(dbh: Schreiber, setNumber: string, partNumber: string, colorId: number, quantity: number, isSpare: boolean) {
  return dbh.run(`
    INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (set_number, part_number, color_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = NOW()`, [setNumber, partNumber, colorId, quantity, isSpare]);
}

export function schreibeTeileKatalog(dbh: Schreiber, nummern: string[], namen: (string | null)[], kategorien: (string | null)[]) {
  return dbh.run(`
    INSERT INTO part_catalog (part_number, part_name, category_name)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (part_number) DO UPDATE SET
      part_name = COALESCE(part_catalog.part_name, EXCLUDED.part_name),
      category_name = COALESCE(part_catalog.category_name, EXCLUDED.category_name),
      updated_at = NOW()`, [nummern, namen, kategorien]);
}

export function schreibeTeilFarben(dbh: Schreiber, nummern: string[], farben: number[], namen: (string | null)[], codes: (string | null)[], bilder: (string | null)[], lokale: (string | null)[]) {
  return dbh.run(`
    INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, image_url, image_local)
    SELECT p, f, n, c, u, NULLIF(l, '') FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) AS x(p, f, n, c, u, l)
    ON CONFLICT (part_number, color_id) DO UPDATE SET
      color_name = COALESCE(part_color_catalog.color_name, EXCLUDED.color_name),
      color_hex = COALESCE(part_color_catalog.color_hex, EXCLUDED.color_hex),
      image_url = COALESCE(part_color_catalog.image_url, EXCLUDED.image_url),
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

export function schreibeFigurenKatalog(dbh: Schreiber, nummern: string[], namen: (string | null)[], bilder: (string | null)[]) {
  return dbh.run(`
    INSERT INTO minifigs_catalog (fig_number, fig_name, image_url)
    SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
    ON CONFLICT (fig_number) DO UPDATE SET
      fig_name = COALESCE(minifigs_catalog.fig_name, EXCLUDED.fig_name),
      image_url = COALESCE(minifigs_catalog.image_url, EXCLUDED.image_url),
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

/** Der geprüfte Wert, sonst die eigene Angabe von `fuer`; fremde Eingaben stehen nicht im Katalog. */
export function teilAusKatalog(partNumber: string, colorId: number | null, fuer: number | null) {
  return db.get<{ name: string | null; kategorie: string | null; bild_allgemein: string | null; farb_url: string | null; farb_datei: string | null }>(`
    SELECT COALESCE(pc.part_name, rp.name, te.part_name)   AS name,
           COALESCE(pc.category_name, te.category_name)     AS kategorie,
           rp.part_img_url                                  AS bild_allgemein,
           COALESCE(pcc.image_url, tfe.image_url)           AS farb_url,
           pcc.image_local                                  AS farb_datei
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN part_catalog       pc  ON pc.part_number  = q.nr
      LEFT JOIN rb_parts           rp  ON rp.part_num     = q.nr
      LEFT JOIN part_color_catalog pcc ON pcc.part_number = q.nr AND pcc.color_id = $2
      LEFT JOIN teil_eigen         te  ON te.user_id = $3 AND te.part_number = q.nr
      LEFT JOIN teil_farbe_eigen   tfe ON tfe.user_id = $3 AND tfe.part_number = q.nr AND tfe.color_id = $2`, [partNumber, colorId, fuer]);
}

export function figurAusKatalog(figNumber: string, fuer: number | null) {
  return db.get<{ fig_name: string | null; image_url: string | null; image_local: string | null }>(`
    SELECT COALESCE(mc.fig_name, fe.fig_name)   AS fig_name,
           COALESCE(mc.image_url, fe.image_url) AS image_url,
           mc.image_local
      FROM (SELECT $1::text AS nr) q
      LEFT JOIN minifigs_catalog mc ON mc.fig_number = q.nr
      LEFT JOIN figur_eigen fe ON fe.user_id = $2 AND fe.fig_number = q.nr
     WHERE mc.fig_number IS NOT NULL OR fe.fig_number IS NOT NULL`, [figNumber, fuer]);
}
