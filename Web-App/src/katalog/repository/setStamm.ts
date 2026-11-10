import type { DbSchnittstelle } from '../../../db/database';

/** Stammdaten eines Sets (set_catalog, catalog_cache) über einen übergebenen
 * Zugang: Das Erfassen schreibt sie in seiner eigenen Transaktion. */

const PLATZHALTER_SQL = "(name = 'Set ' || set_number AND year IS NULL AND theme IS NULL AND pieces IS NULL)";

/** Vorhandene Werte bleiben, wo der neue Abruf nichts liefert. */
export function merkeSetKatalog(
  db: DbSchnittstelle,
  setNumber: string,
  name: string | null,
  year: number | null,
  theme: string | null,
  pieces: number | null,
  minifigs: number | null,
  imageUrl: string | null,
  localImage: string | null,
) {
  return db.run(
    `INSERT INTO set_catalog (set_number,name,year,theme,pieces,minifigs,image_url,image_local)
                VALUES ($1, COALESCE($2, 'Set ' || $1), $3,$4,$5,$6,$7,$8)
                ON CONFLICT (set_number) DO UPDATE SET
                  name = COALESCE($2, set_catalog.name), year = COALESCE($3, set_catalog.year),
                  theme = COALESCE($4, set_catalog.theme), pieces = COALESCE($5, set_catalog.pieces),
                  minifigs = COALESCE($6, set_catalog.minifigs),
                  image_url = COALESCE($7, set_catalog.image_url),
                  image_local = COALESCE($8, set_catalog.image_local), updated_at = NOW()`,
    [setNumber, name, year, theme, pieces, minifigs, imageUrl, localImage],
  );
}

/** Ohne Netz angelegt: Der Platzhalter macht das Set lesbar, bis der Auftrag den Katalog holt. */
export async function merkeKatalogPlatzhalter(dbh: DbSchnittstelle, setNumber: string) {
  await dbh.run(
    "INSERT INTO set_catalog (set_number, name) VALUES ($1, 'Set ' || $1) ON CONFLICT (set_number) DO NOTHING",
    [setNumber],
  );
  return katalogStand(setNumber, dbh);
}

export function katalogStand(setNumber: string, dbh: DbSchnittstelle) {
  return dbh.get<{ name: string | null; image_local: string | null; minifigs: number | null; platzhalter: boolean }>(
    `SELECT name, image_local, minifigs, ${PLATZHALTER_SQL} AS platzhalter FROM set_catalog WHERE set_number = $1`,
    [setNumber],
  );
}

export function setzeFigurenzahl(db: DbSchnittstelle, minifigs: number, setNumber: string) {
  return db.run('UPDATE set_catalog SET minifigs = $1 WHERE set_number = $2', [minifigs, setNumber]);
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
