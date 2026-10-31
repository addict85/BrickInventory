import * as db from '../../../db/database';

/** Gewünschte Katalogbilder (image_wanted): Adressen, die ein Client brauchte und die noch geholt werden. */

export function merkeBildwuensche(urls: string[], sets: (string | null)[]) {
  return db.run(`INSERT INTO image_wanted (url, set_number)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (url) DO NOTHING`, [urls, sets]);
}

export function loescheAlteBildwuensche(alterMs: string) {
  return db.run(`DELETE FROM image_wanted
      WHERE requested_at <= NOW() - ($1 || ' milliseconds')::interval`, [alterMs]);
}

export function zaehleBildwuensche() {
  return db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM image_wanted');
}

export function loescheAlleBildwuensche() {
  return db.run('DELETE FROM image_wanted');
}

export function entnimmBildwuensche(gueltigMs: string, anzahl: number) {
  return db.all<{ url: string; set_number: string | null }>(
    `DELETE FROM image_wanted
      WHERE url IN (SELECT url FROM image_wanted
                     WHERE requested_at > NOW() - ($1 || ' milliseconds')::interval
                     ORDER BY requested_at ASC LIMIT $2)
      RETURNING url, set_number`, [gueltigMs, anzahl]);
}
