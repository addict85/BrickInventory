import { mengeSkalar } from '../../../db/bestandsmenge';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';
import type { KatalogTeil, ListenTeil, SetStamm } from '../dienst';
import * as db from '../../../db/database';

export function setStamm(setNumber: string) {
  return db.get<SetStamm>(`SELECT name, year, theme, pieces, image_url, image_local,
    name = 'Set ' || set_number AND year IS NULL AND theme IS NULL AND pieces IS NULL AS platzhalter
    FROM set_stamm WHERE set_number = $1`, [setNumber]);
}

export function setKatalog(setNumber: string) {
  return db.get<SetStamm>('SELECT name, image_local, image_url, year, pieces, theme, minifigs FROM set_catalog WHERE set_number=$1', [setNumber]);
}

export function merkeKatalogCache(setNumber: string, name: string, year: number | null, theme: string | null, pieces: number | null, imageUrl: string | null) {
  return db.run('INSERT INTO catalog_cache(set_number,name,year,theme,pieces,image_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(set_number) DO UPDATE SET name=$2,year=$3,theme=$4,pieces=$5,image_url=$6', [setNumber, name, year, theme, pieces, imageUrl]);
}

export function katalogCacheEintrag(setNumber: string) {
  return db.get<SetStamm>('SELECT name, image_url, year, pieces, theme FROM catalog_cache WHERE set_number=$1', [setNumber]);
}

export function ersterKatalogTreffer(nummern: string[]) {
  return db.get('SELECT set_number, name FROM catalog_cache WHERE set_number = ANY($1) LIMIT 1', [nummern]);
}

export function katalogCacheNachNummer(setNumber: string) {
  return db.get<{ set_number: string; name: string | null }>('SELECT set_number, name FROM catalog_cache WHERE set_number = $1', [setNumber]);
}

export function katalogTeileDesSets(setNumber: string) {
  return db.all<KatalogTeil>(`SELECT c.part_number, c.color_id, ${blNummerSql('c.part_number')} AS bl_part_number,
            c.part_name, c.color_name, c.color_hex, c.image_url, c.image_local
       FROM set_parts_catalog c
       ${blJoin('c.part_number', 'part', null)}
      WHERE c.set_number = $1`, [setNumber]);
}

export function inventarTeileDesSets(invId: number) {
  return db.all<ListenTeil>(`SELECT ip.part_num AS part_number, ip.color_id, ip.quantity AS total_quantity, ip.is_spare,
              COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
              p.name AS part_name, p.part_img_url AS rb_image_url,
              c.name AS color_name, c.rgb AS color_hex, c.bl_color_id
         FROM rb_inventory_parts ip
         LEFT JOIN rb_parts      p ON p.part_num = ip.part_num
         LEFT JOIN rb_colors     c ON c.id       = ip.color_id
         LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
        WHERE ip.inventory_id = $1
          AND NOT ip.is_spare`, [invId]);
}

export function inventarFigurenDesSets(invId: number) {
  return db.all(`SELECT ip.part_num AS fig_number, ip.quantity, COALESCE(mc.fig_name, ip.part_num) AS fig_name, mc.image_url
         FROM rb_inventory_parts ip
         LEFT JOIN minifigs_catalog mc ON mc.fig_number = ip.part_num
        WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`, [invId]);
}

export function setImFeld(setNumber: string, blickfeld: number[]) {
  return db.get('SELECT 1 AS da FROM sets WHERE set_number = $1 AND user_id = ANY($2) LIMIT 1', [setNumber, blickfeld]);
}

export function setsMitMenge(uid: number) {
  return db.all<{ set_number: string; quantity: number }>(`SELECT s.set_number, ${mengeSkalar('s')} AS quantity FROM sets s WHERE s.user_id=$1 ORDER BY s.set_number ASC`, [uid]);
}

export function setDesKontos(uid: number, setNumber: string) {
  return db.get('SELECT 1 AS ok FROM sets WHERE user_id = $1 AND set_number = $2', [uid, setNumber]);
}

export function fuegeAnleitungEin(uid: number, setNumber: string, pfad: string, beschreibung: string | null, lokalerPfad: string) {
  return db.run('INSERT INTO instructions (user_id,set_number,url,description,local_path) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [uid, setNumber, pfad, beschreibung, lokalerPfad]);
}

export function anleitungsPfad(id: string, uid: number) {
  return db.get<{ local_path: string | null }>('SELECT local_path FROM instructions WHERE id = $1 AND user_id = $2', [id, uid]);
}

export function loescheAnleitung(id: string, uid: number) {
  return db.run('DELETE FROM instructions WHERE id = $1 AND user_id = $2', [id, uid]);
}

export function anleitungsdateiBenutzt(pfad: string) {
  return db.get('SELECT 1 AS ok FROM instructions WHERE local_path = $1 LIMIT 1', [pfad]);
}
