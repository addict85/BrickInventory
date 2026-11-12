import type { DbSchnittstelle } from '../../../db/database';

export async function setsMitFehlendenKatalogbildern(db: DbSchnittstelle): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>(
    `SELECT DISTINCT set_number FROM set_parts_catalog
     WHERE image_url IS NOT NULL AND image_local IS NULL
     UNION
     SELECT DISTINCT set_number FROM set_minifigs_catalog
     WHERE image_url IS NOT NULL AND image_local IS NULL`,
  );
  return rows.map(r => r.set_number);
}

/** Der gemeinsame Katalog führt nur geprüfte Adressen: Die Datei gilt für alle Konten. */
export async function manuelleTeileOhneBild(
  db: DbSchnittstelle,
): Promise<{ part_number: string; color_id: number; image_url: string }[]> {
  return db.all(
    `SELECT DISTINCT pcc.part_number, pcc.color_id, pcc.image_url
       FROM part_color_catalog pcc
       JOIN parts p ON p.part_number = pcc.part_number
                   AND p.color_id    = pcc.color_id
                   AND p.source      = 'manual'
      WHERE pcc.image_url IS NOT NULL AND pcc.image_local IS NULL`,
  );
}

export async function figurenOhneBild(db: DbSchnittstelle): Promise<{ fig_number: string; image_url: string }[]> {
  return db.all(
    `SELECT mc.fig_number, mc.image_url FROM minifigs_catalog mc
      WHERE mc.image_url IS NOT NULL AND mc.image_local IS NULL
        AND EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_number = mc.fig_number)
      ORDER BY mc.fig_number`,
  );
}

export async function setBilderOhneDatei(
  db: DbSchnittstelle,
  grenze = 500,
): Promise<{ set_number: string; image_url: string }[]> {
  return db.all(
    `SELECT set_number, image_url FROM set_catalog
     WHERE image_local IS NULL AND image_url IS NOT NULL LIMIT $1`,
    [grenze],
  );
}

/** Schreibt nur, was fehlt. Über rb_sets, damit eine fehlende set_catalog-Zeile
 * entsteht, ohne den Fremdschlüssel zu verletzen; ein unbekanntes Set bleibt aussen vor. */
export async function merkeSetBildLokal(
  db: DbSchnittstelle,
  setNumber: string,
  lokal: string,
  quelle: string | null = null,
): Promise<void> {
  await db.run(
    `INSERT INTO set_catalog (set_number, image_local, image_url)
     SELECT rs.set_num, $1, $3 FROM rb_sets rs WHERE rs.set_num = $2
     ON CONFLICT (set_number) DO UPDATE SET
       image_local = COALESCE(set_catalog.image_local, EXCLUDED.image_local),
       image_url = COALESCE(set_catalog.image_url, EXCLUDED.image_url), updated_at = NOW()
     WHERE set_catalog.image_local IS NULL
        OR (set_catalog.image_url IS NULL AND EXCLUDED.image_url IS NOT NULL)`,
    [lokal, setNumber, quelle],
  );
}

export async function lokaleKatalogbilder(db: DbSchnittstelle): Promise<string[]> {
  const rows = await db.all<{ image_local: string }>(
    `SELECT image_local FROM set_catalog WHERE image_local IS NOT NULL
     UNION ALL SELECT image_local FROM part_color_catalog WHERE image_local IS NOT NULL
     UNION ALL SELECT image_local FROM minifigs_catalog WHERE image_local IS NOT NULL`,
  );
  return rows.map(r => r.image_local).filter(Boolean);
}

export interface Bildstand {
  image_local: string | null;
  image_url: string | null;
}

export async function teilbilder(
  db: DbSchnittstelle,
  teile: string[],
): Promise<(Bildstand & { part_number: string; color_id: number })[]> {
  return db.all(
    `SELECT part_number, color_id, image_local, image_url
       FROM part_color_catalog WHERE part_number = ANY($1)`,
    [teile],
  );
}

export async function figurenbilder(
  db: DbSchnittstelle,
  figuren: string[],
): Promise<(Bildstand & { fig_number: string })[]> {
  return db.all(
    `SELECT fig_number, image_local, image_url
       FROM minifigs_catalog WHERE fig_number = ANY($1)`,
    [figuren],
  );
}

/** Nur Lücken einer Zeile der Erfassung ('api'): Was das Rebrickable-CSV führt, bleibt. */
export async function fuelleSetLuecken(
  db: DbSchnittstelle,
  setNumber: string,
  i: {
    name?: string | null;
    year?: number | null;
    theme?: string | null;
    pieces?: number | null;
    minifigs?: number | null;
  },
): Promise<void> {
  await db.run(
    `UPDATE rb_sets SET name = CASE WHEN name IS NULL OR name = 'Set ' || set_num THEN COALESCE($1, name) ELSE name END,
            year = COALESCE(year, $2), num_parts = COALESCE(num_parts, $4),
            theme_id = COALESCE(theme_id, (SELECT t.id FROM rb_themes t WHERE t.name = $3
                                            ORDER BY t.parent_id NULLS FIRST, t.id LIMIT 1))
      WHERE set_num = $5 AND herkunft = 'api'`,
    [i.name ?? null, i.year ?? null, i.theme ?? null, i.pieces ?? null, setNumber],
  );
  await db.run('UPDATE set_catalog SET minifigs = COALESCE(minifigs, $1) WHERE set_number = $2', [
    i.minifigs ?? null,
    setNumber,
  ]);
}

export async function setsOhneAnleitungsabruf(db: DbSchnittstelle): Promise<string[]> {
  const rows = await db.all<{ set_number: string }>(
    `SELECT DISTINCT s.set_number FROM sets s
     WHERE NOT EXISTS (SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number)
       AND NOT EXISTS (SELECT 1 FROM auftraege a WHERE a.schluessel = 'anleitung:' || s.set_number
                         AND a.status IN ('offen', 'laeuft', 'erledigt'))`,
  );
  return rows.map(r => r.set_number);
}
