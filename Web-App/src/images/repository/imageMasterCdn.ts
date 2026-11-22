import type { DbInterface } from '../../../db/database';

/** The order is that of the query; figure images are only in minifigs_catalog. */
export const CDN_QUERY = `
  SELECT url FROM (
    (SELECT image_url AS url, 1 AS r FROM part_color_catalog
      WHERE image_local IS NOT NULL AND image_master(image_local) = $1 AND image_url IS NOT NULL LIMIT 1)
    UNION ALL
    (SELECT image_url, 3 FROM minifigs_catalog
      WHERE image_local IS NOT NULL AND image_master(image_local) = $1 AND image_url IS NOT NULL LIMIT 1)
    UNION ALL
    (SELECT image_url, 4 FROM set_catalog
      WHERE image_local IS NOT NULL AND image_master(image_local) = $1 AND image_url IS NOT NULL LIMIT 1)
  ) t ORDER BY r LIMIT 1`;

export function cdnToImageMaster(db: DbInterface, master: string) {
  return db.get<{ url: string }>(CDN_QUERY, [master]);
}
