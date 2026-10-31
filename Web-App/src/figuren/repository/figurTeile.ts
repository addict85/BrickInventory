import { ersatzteilSql } from '../../infra/validate';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';
import type { FigurTeil, KatalogZeile } from '../dienst';
import * as db from '../../../db/database';

/** Die Teile einer Minifigur: aus dem eigenen Katalog oder aus dem Rebrickable-Inventar. */

export function katalogTeileDerFigur(figNumber: string) {
  return db.all<KatalogZeile>(`SELECT c.part_number, c.color_id, ${blNummerSql('c.part_number')} AS bl_part_number, c.image_url, c.image_local
       FROM set_parts_catalog c ${blJoin('c.part_number', 'part')}
      WHERE c.set_number = $1`, [figNumber]);
}

export function inventarTeileDerFigur(invId: number) {
  return db.all<FigurTeil>(`SELECT ip.part_num AS part_number, COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
            p.name AS part_name, ip.color_id, c.name AS color_name, c.rgb AS color_hex,
            ${ersatzteilSql('ip.is_spare')} AS is_spare, ip.quantity
       FROM rb_inventory_parts ip
       LEFT JOIN rb_parts  p ON p.part_num = ip.part_num
       LEFT JOIN rb_colors c ON c.id       = ip.color_id
       LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = ip.part_num
      WHERE ip.inventory_id = $1`, [invId]);
}

export function setMitFigur(figNumber: string) {
  return db.get<{ set_number: string }>('SELECT set_number FROM set_figuren WHERE fig_number=$1 LIMIT 1', [figNumber]);
}
