import type { DbInterface } from '../../../db/database';

export function freshFailures(db: DbInterface, alterMs: string) {
  return db.all<{ cache_key: string; checked_at: Date; reason: string | null }>(
    `SELECT cache_key, checked_at, reason FROM image_misses
      WHERE checked_at > NOW() - ($1 || ' milliseconds')::interval`,
    [alterMs],
  );
}

export function forgetFailures(db: DbInterface, keys: string[]) {
  return db.run(`DELETE FROM image_misses WHERE cache_key = ANY($1::text[])`, [keys]);
}

export function forgetAllFailures(db: DbInterface) {
  return db.run(`DELETE FROM image_misses`);
}

export function rememberFailures(db: DbInterface, keys: string[], reasons: string[]) {
  return db.run(
    `INSERT INTO image_misses (cache_key, checked_at, reason)
       SELECT * FROM unnest($1::text[], ARRAY(SELECT NOW() FROM unnest($1::text[])), $2::text[])
       ON CONFLICT (cache_key) DO UPDATE SET checked_at = NOW(), reason = EXCLUDED.reason`,
    [keys, reasons],
  );
}
