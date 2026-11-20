import type { DbInterface } from '../../../db/database';

export function rememberImageRequests(db: DbInterface, urls: string[], sets: (string | null)[]) {
  return db.run(
    `INSERT INTO image_wanted (url, set_number)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (url) DO NOTHING`,
    [urls, sets],
  );
}

export function deleteOldImageRequests(db: DbInterface, alterMs: string) {
  return db.run(
    `DELETE FROM image_wanted
      WHERE requested_at <= NOW() - ($1 || ' milliseconds')::interval`,
    [alterMs],
  );
}

export function countImageRequests(db: DbInterface) {
  return db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM image_wanted');
}

export function deleteAllImageRequests(db: DbInterface) {
  return db.run('DELETE FROM image_wanted');
}

export function entnimmBildwuensche(db: DbInterface, validMs: string, anzahl: number) {
  return db.all<{ url: string; set_number: string | null }>(
    `DELETE FROM image_wanted
      WHERE url IN (SELECT url FROM image_wanted
                     WHERE requested_at > NOW() - ($1 || ' milliseconds')::interval
                     ORDER BY requested_at ASC LIMIT $2)
      RETURNING url, set_number`,
    [validMs, anzahl],
  );
}

/** Counts only what was not already waiting. */
export function seriesCatalogImagesOne(
  db: DbInterface,
  urls: string[],
  sets: string[],
): Promise<{ n: number } | undefined> {
  return db.get<{ n: number }>(
    `WITH neu AS (
           INSERT INTO image_wanted (url, set_number)
             SELECT * FROM unnest($1::text[], $2::text[])
             ON CONFLICT (url) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS n FROM neu`,
    [urls, sets],
  );
}
