import type { DbInterface } from '../../../db/database';

/** Existing values stay where the new fetch delivers nothing. Name, year, theme
 * and parts go to rb_sets, but only into a capture row ('api'):
 * what the Rebrickable CSV lists is not overwritten by a single fetch. */
export function rememberSetCatalog(
  dbh: DbInterface,
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
  // One statement: the set_catalog row sees the rb_sets row from the same one.
  return dbh.run(
    `WITH stamm AS (
                    INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, source)
                    VALUES ($1, COALESCE($2, 'Set ' || $1), $3,
                            COALESCE($6, (SELECT t.id FROM rb_themes t WHERE t.name = $4
                                           ORDER BY t.parent_id NULLS FIRST, t.id LIMIT 1)), $5, 'api')
                    ON CONFLICT (set_num) DO UPDATE SET
                      name = COALESCE($2, rb_sets.name), year = COALESCE($3, rb_sets.year),
                      theme_id = COALESCE(EXCLUDED.theme_id, rb_sets.theme_id),
                      num_parts = COALESCE($5, rb_sets.num_parts)
                    WHERE rb_sets.source = 'api')
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

/** Created without network: the placeholder makes the set readable until the job fetches the catalog.
 * If rb_sets already knows the set (CSV), its row stays. */
export async function rememberCatalogPlaceholder(dbh: DbInterface, setNumber: string) {
  await dbh.run(
    "INSERT INTO rb_sets (set_num, name, source) VALUES ($1, 'Set ' || $1, 'api') ON CONFLICT (set_num) DO NOTHING",
    [setNumber],
  );
  await dbh.run('INSERT INTO set_catalog (set_number) VALUES ($1) ON CONFLICT (set_number) DO NOTHING', [setNumber]);
  return catalogStatus(dbh, setNumber);
}

export function catalogStatus(dbh: DbInterface, setNumber: string) {
  return dbh.get<{ name: string | null; image_local: string | null; minifigs: number | null; platzhalter: boolean }>(
    `SELECT rs.name, c.image_local, c.minifigs, ${PLATZHALTER_SQL} AS platzhalter
       FROM rb_sets rs LEFT JOIN set_catalog c ON c.set_number = rs.set_num
      WHERE rs.set_num = $1`,
    [setNumber],
  );
}
