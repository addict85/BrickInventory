import type { DbSchnittstelle } from '../../../db/database';
import type { KatalogLesevertrag } from '../lesevertrag';

export function figurenDesSetkatalogs(db: DbSchnittstelle, setNumber: string) {
  return db.all<{ fig_number: string; fig_name: string | null; quantity: number | null; image_url: string | null }>(
    `SELECT fig_number, fig_name, quantity, image_url
       FROM set_minifigs_catalog
      WHERE set_number = $1`,
    [setNumber],
  );
}

export function teileOhneBlZuordnung(db: DbSchnittstelle, l: KatalogLesevertrag) {
  return db.all<{ part_number: string }>(`SELECT DISTINCT p.part_number FROM ${l.teilBestand()} p
       LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = p.part_number
       WHERE m.rb_id IS NULL
         AND p.part_number IS NOT NULL
         AND p.source != 'manual'
       LIMIT 5000`);
}
