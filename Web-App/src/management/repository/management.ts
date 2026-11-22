import type { DbInterface } from '../../../db/database';
import { LIKE_ESCAPE, likeLiteral } from '../../../db/likeSearch';
import { quantityScalar } from '../../../db/stockQuantity';
import type { Columns } from '../../../db/rows';

/** The route does not talk to db/ itself. */

type ImageRow = { image_url: string | null; image_local: string | null };
export type AccountImageRow = { anzahl_konten: number } & ImageRow;
type ImageMissRow = { checked_at: Date; reason: string | null };
type CacheKeyRow = { cache_key: string };

/** COUNT as a number: ::int, because bigint would arrive as text. */
async function count(db: DbInterface, sql: string): Promise<number> {
  return (await db.get<{ c: number }>(sql))?.c ?? 0;
}

export function pricesInCache(db: DbInterface): Promise<number> {
  return count(db, 'SELECT COUNT(*)::int AS c FROM price_cache');
}

export function stalePrices(db: DbInterface): Promise<number> {
  return count(db, "SELECT COUNT(*)::int AS c FROM price_cache WHERE fetched_at <= NOW() - INTERVAL '24 hours'");
}

/** Only the number of accounts (function from 0119): which one holds a set is none of the admin's business either. */
export async function accountImageRows(db: DbInterface, sn: string): Promise<AccountImageRow> {
  const z = await db.get<AccountImageRow>(
    `SELECT n.anzahl AS anzahl_konten, CASE WHEN n.anzahl > 0 THEN c.image_local END AS image_local,
            CASE WHEN n.anzahl > 0 THEN c.image_url END AS image_url
       FROM (SELECT konten_mit_set($1) AS anzahl) n LEFT JOIN set_catalog c ON c.set_number = $1`,
    [sn],
  );
  return z ?? { anzahl_konten: 0, image_local: null, image_url: null };
}

export function catalogImage(db: DbInterface, sn: string): Promise<ImageRow | undefined> {
  return db.get<Columns<'set_catalog', 'image_url' | 'image_local'>>(
    `SELECT image_url, image_local FROM set_catalog WHERE set_number = $1`,
    [sn],
  );
}

export function setImageMiss(db: DbInterface, sn: string): Promise<ImageMissRow | undefined> {
  return db.get<Columns<'image_misses', 'checked_at' | 'reason'>>(
    `SELECT checked_at, reason FROM image_misses WHERE cache_key = $1`,
    ['set:' + sn],
  );
}

/** @param file the file name without extension, as the image storage forms it */
export function thumbnailImageMiss(db: DbInterface, file: string): Promise<ImageMissRow | undefined> {
  return db.get<Columns<'image_misses', 'checked_at' | 'reason'>>(
    `SELECT checked_at, reason FROM image_misses WHERE cache_key LIKE $1${LIKE_ESCAPE}`,
    ['thumb:%' + likeLiteral(file + '_thumb.jpg')],
  );
}

export function setImageMisses(db: DbInterface): Promise<CacheKeyRow[]> {
  return db.all<Columns<'image_misses', 'cache_key'>>(
    `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'set:%'`,
  );
}

export function thumbnailImageMisses(db: DbInterface): Promise<CacheKeyRow[]> {
  return db.all<Columns<'image_misses', 'cache_key'>>(
    `SELECT cache_key FROM image_misses WHERE cache_key LIKE 'thumb:%'`,
  );
}

/** A 404 from the CDN stays recorded: a new attempt changes nothing about it. */
export function setImageMissesWithout404(db: DbInterface): Promise<CacheKeyRow[]> {
  return db.all<Columns<'image_misses', 'cache_key'>>(
    `SELECT cache_key FROM image_misses
            WHERE cache_key LIKE 'set:%'
              AND (reason IS NULL OR reason NOT LIKE '%404%')`,
  );
}

export function catalogImageCandidates(db: DbInterface): Promise<{ set_num: string; set_img_url: string }[]> {
  return db.all<{ set_num: string; set_img_url: string }>(
    `SELECT rb.set_num, rb.set_img_url FROM rb_sets rb
        WHERE rb.set_img_url IS NOT NULL AND rb.set_img_url <> ''
          AND NOT EXISTS (SELECT 1 FROM image_misses m
                           WHERE m.cache_key = 'set:' || rb.set_num)`,
  );
}

export function openImageJobs(db: DbInterface): Promise<{ n: number } | undefined> {
  return db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM image_wanted`);
}

export function catalogImagesOpen(db: DbInterface): Promise<number> {
  return count(db, `SELECT COUNT(*)::int AS c FROM image_wanted`);
}

export function setsWithoutInstructions(db: DbInterface): Promise<{ set_number: string }[]> {
  return db.all<{ set_number: string }>(`
      SELECT DISTINCT s.set_number
      FROM sets s
      WHERE NOT EXISTS (
        SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number
      )
      ORDER BY s.set_number
    `);
}

export function logSince(
  db: DbInterface,
  minutes: number,
): Promise<{ id: number; level: string; message: string; logged_at: Date }[]> {
  return db.all<{ id: number; level: string; message: string; logged_at: Date }>(
    // bigint would come as text; the contract (and the log window) names a number.
    `SELECT id::float8 AS id, level, message, logged_at
       FROM app_logs
       WHERE logged_at >= NOW() - ($1 || ' minutes')::INTERVAL
       ORDER BY logged_at ASC
       LIMIT 5000`,
    [minutes],
  );
}

/** Only kind 'part': the metric compares looked-up parts with the number of parts. */
export function mappedParts(db: DbInterface): Promise<number> {
  return count(db, `SELECT COUNT(*)::int AS c FROM bl_mapping WHERE type='part'`);
}

export function bricklinkParts(db: DbInterface): Promise<number> {
  return count(db, `SELECT COUNT(DISTINCT part_number)::int AS c FROM parts WHERE source!='manual'`);
}

export function rbParts(db: DbInterface): Promise<number> {
  return count(db, `SELECT COUNT(*)::int AS c FROM rb_parts`);
}

export function rbInventoryParts(db: DbInterface): Promise<number> {
  return count(db, `SELECT COUNT(*)::int AS c FROM rb_inventory_parts`);
}

export function partImagesOpen(db: DbInterface): Promise<number> {
  return count(
    db,
    `SELECT COUNT(*)::int AS c FROM set_parts_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`,
  );
}

export function partImagesDone(db: DbInterface): Promise<number> {
  return count(db, `SELECT COUNT(*)::int AS c FROM set_parts_catalog WHERE image_local IS NOT NULL`);
}

export function setMinifigImagesOpen(db: DbInterface): Promise<number> {
  return count(
    db,
    `SELECT COUNT(*)::int AS c FROM set_minifigs_catalog WHERE image_url IS NOT NULL AND image_local IS NULL`,
  );
}

/** The EXISTS keeps the set at what the background run really fetches,
 * otherwise the open number would not match the progress. */
export function holdingMinifigImagesOpen(db: DbInterface): Promise<number> {
  return count(
    db,
    `SELECT COUNT(*)::int AS c FROM minifigs_catalog mc
             WHERE mc.image_url IS NOT NULL AND mc.image_local IS NULL
               AND EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_number = mc.fig_number)`,
  );
}

/** The quantity from the acquisitions — the same sum the valuation sees. */
export function sampleSet(db: DbInterface, uid: number, setNumber: string) {
  return db.get<{ set_number: string; quantity: number }>(
    `SELECT s.set_number, ${quantityScalar('s')} AS quantity
              FROM sets s WHERE s.user_id=$1 AND s.set_number=$2`,
    [uid, setNumber],
  );
}

export function sampleAcquisitions(
  db: DbInterface,
  uid: number,
  setNumber: string,
): Promise<{ quantity: number; condition: string; purchase_price: number | null; created_at: Date }[]> {
  return db.all<Columns<'set_acquisitions', 'quantity' | 'condition' | 'purchase_price' | 'created_at'>>(
    'SELECT quantity, condition, purchase_price, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at',
    [uid, setNumber],
  );
}

export function samplePriceCache(db: DbInterface, setNumber: string) {
  return db.all<Record<string, unknown>>(
    `SELECT condition, currency_code, avg_price, qty_avg_price, min_price, max_price, fetched_at,
                   EXTRACT(EPOCH FROM (NOW() - fetched_at))/3600 AS age_hours
              FROM price_cache WHERE set_number=$1 ORDER BY condition, currency_code`,
    [setNumber],
  );
}

export function samplePriceHistory(db: DbInterface, setNumber: string) {
  return db.all<Record<string, unknown>>(
    `SELECT condition, avg_price, qty_avg_price, recorded_at FROM price_history
             WHERE set_number=$1 ORDER BY recorded_at DESC LIMIT 5`,
    [setNumber],
  );
}

export function lastRunOfType(db: DbInterface) {
  return db.get<{
    status: string;
    due_at: Date;
    progress: Record<string, unknown> | null;
  }>(`SELECT status, due_at, progress FROM jobs
      WHERE type = 'preise' AND status IN ('offen', 'laeuft') ORDER BY status = 'laeuft' DESC, due_at LIMIT 1`);
}
