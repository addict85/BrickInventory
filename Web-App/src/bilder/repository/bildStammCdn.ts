import type { DbSchnittstelle } from '../../../db/database';

/** Die Reihenfolge ist die der Abfrage; Figurenbilder stehen nur in minifigs_catalog. */
export const CDN_ABFRAGE = `
  SELECT url FROM (
    (SELECT image_url AS url, 1 AS r FROM part_color_catalog
      WHERE image_local IS NOT NULL AND bild_stamm(image_local) = $1 AND image_url IS NOT NULL LIMIT 1)
    UNION ALL
    (SELECT image_url, 3 FROM minifigs_catalog
      WHERE image_local IS NOT NULL AND bild_stamm(image_local) = $1 AND image_url IS NOT NULL LIMIT 1)
    UNION ALL
    (SELECT image_url, 4 FROM set_catalog
      WHERE image_local IS NOT NULL AND bild_stamm(image_local) = $1 AND image_url IS NOT NULL LIMIT 1)
  ) t ORDER BY r LIMIT 1`;

export function cdnZuBildstamm(db: DbSchnittstelle, stamm: string) {
  return db.get<{ url: string }>(CDN_ABFRAGE, [stamm]);
}
