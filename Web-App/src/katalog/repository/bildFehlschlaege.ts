import * as db from '../../../db/database';

/** Bilder, die es an der Quelle nicht gab (image_misses), mit Grund und Zeitpunkt. */

export function frischeFehlschlaege(alterMs: string) {
  return db.all(`SELECT cache_key, checked_at, reason FROM image_misses
      WHERE checked_at > NOW() - ($1 || ' milliseconds')::interval`, [alterMs]);
}

export function vergissFehlschlaege(keys: string[]) {
  return db.run(`DELETE FROM image_misses WHERE cache_key = ANY($1::text[])`, [keys]);
}

export function vergissAlleFehlschlaege() {
  return db.run(`DELETE FROM image_misses`);
}

export function merkeFehlschlaege(keys: string[], gruende: string[]) {
  return db.run(`INSERT INTO image_misses (cache_key, checked_at, reason)
       SELECT * FROM unnest($1::text[], ARRAY(SELECT NOW() FROM unnest($1::text[])), $2::text[])
       ON CONFLICT (cache_key) DO UPDATE SET checked_at = NOW(), reason = EXCLUDED.reason`, [keys, gruende]);
}
