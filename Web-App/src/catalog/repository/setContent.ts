import type { DbInterface } from '../../../db/database';
import type { CatalogReadContract } from '../readContract';

export function minifigsOfSetCatalog(db: DbInterface, setNumber: string) {
  return db.all<{ fig_number: string; fig_name: string | null; quantity: number | null; image_url: string | null }>(
    `SELECT fig_number, fig_name, quantity, image_url
       FROM set_minifigs_catalog
      WHERE set_number = $1`,
    [setNumber],
  );
}

export function partsWithoutBlMapping(db: DbInterface, l: CatalogReadContract) {
  return db.all<{ part_number: string }>(`SELECT DISTINCT p.part_number FROM ${l.partHoldings()} p
       LEFT JOIN bl_mapping m ON m.type = 'part' AND m.rb_id = p.part_number
       WHERE m.rb_id IS NULL
         AND p.part_number IS NOT NULL
         AND p.source != 'manual'
       LIMIT 5000`);
}
