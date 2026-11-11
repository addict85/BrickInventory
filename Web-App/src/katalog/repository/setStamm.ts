import type { DbSchnittstelle } from '../../../db/database';

/** Vorhandene Werte bleiben, wo der neue Abruf nichts liefert. Name, Jahr, Thema
 * und Teile gehen nach rb_sets, aber nur in eine Zeile der Erfassung ('api'):
 * Was das Rebrickable-CSV führt, überschreibt kein Einzelabruf. */
export function merkeSetKatalog(
  dbh: DbSchnittstelle,
  setNumber: string,
  name: string | null,
  year: number | null,
  theme: string | null,
  pieces: number | null,
  minifigs: number | null,
  imageUrl: string | null,
  localImage: string | null,
  themeId: number | null = null,
) {
  // Eine Anweisung: Die set_catalog-Zeile sieht die rb_sets-Zeile aus derselben.
  return dbh.run(
    `WITH stamm AS (
                    INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, herkunft)
                    VALUES ($1, COALESCE($2, 'Set ' || $1), $3,
                            COALESCE($6, (SELECT t.id FROM rb_themes t WHERE t.name = $4
                                           ORDER BY t.parent_id NULLS FIRST, t.id LIMIT 1)), $5, 'api')
                    ON CONFLICT (set_num) DO UPDATE SET
                      name = COALESCE($2, rb_sets.name), year = COALESCE($3, rb_sets.year),
                      theme_id = COALESCE(EXCLUDED.theme_id, rb_sets.theme_id),
                      num_parts = COALESCE($5, rb_sets.num_parts)
                    WHERE rb_sets.herkunft = 'api')
                  INSERT INTO set_catalog (set_number, minifigs, image_url, image_local) VALUES ($1, $7, $8, $9)
                  ON CONFLICT (set_number) DO UPDATE SET
                    minifigs = COALESCE($7, set_catalog.minifigs),
                    image_url = COALESCE($8, set_catalog.image_url),
                    image_local = COALESCE($9, set_catalog.image_local), updated_at = NOW()`,
    [setNumber, name, year, theme, pieces, themeId, minifigs, imageUrl, localImage],
  );
}

const PLATZHALTER_SQL =
  "(rs.name = 'Set ' || rs.set_num AND rs.year IS NULL AND rs.theme_id IS NULL AND rs.num_parts IS NULL)";

/** Ohne Netz angelegt: Der Platzhalter macht das Set lesbar, bis der Auftrag den Katalog holt.
 * Kennt rb_sets das Set schon (CSV), bleibt dessen Zeile. */
export async function merkeKatalogPlatzhalter(dbh: DbSchnittstelle, setNumber: string) {
  await dbh.run(
    "INSERT INTO rb_sets (set_num, name, herkunft) VALUES ($1, 'Set ' || $1, 'api') ON CONFLICT (set_num) DO NOTHING",
    [setNumber],
  );
  await dbh.run('INSERT INTO set_catalog (set_number) VALUES ($1) ON CONFLICT (set_number) DO NOTHING', [setNumber]);
  return katalogStand(dbh, setNumber);
}

export function katalogStand(dbh: DbSchnittstelle, setNumber: string) {
  return dbh.get<{ name: string | null; image_local: string | null; minifigs: number | null; platzhalter: boolean }>(
    `SELECT rs.name, c.image_local, c.minifigs, ${PLATZHALTER_SQL} AS platzhalter
       FROM rb_sets rs LEFT JOIN set_catalog c ON c.set_number = rs.set_num
      WHERE rs.set_num = $1`,
    [setNumber],
  );
}

export function merkeKatalogCache(
  db: DbSchnittstelle,
  setNumber: string,
  name: string,
  year: number | null,
  theme: string | null,
  pieces: number | null,
  imageUrl: string | null,
) {
  return db.run(
    'INSERT INTO catalog_cache(set_number,name,year,theme,pieces,image_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(set_number) DO UPDATE SET name=$2,year=$3,theme=$4,pieces=$5,image_url=$6',
    [setNumber, name, year, theme, pieces, imageUrl],
  );
}
