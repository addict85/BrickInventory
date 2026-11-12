import type { DbSchnittstelle } from '../../../db/database';
import { mengeSkalar } from '../../../db/bestandsmenge';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';
import type { KatalogTeil, ListenTeil, SetStamm } from '../zeilen';
import { setStammJoin, SET } from '../../../db/katalogSicht';

/** Angaben aus rb_sets, Bild und Figuren aus set_catalog (0108). Ein Platzhalter
 * „Set …“ sagt nur, dass irgendein Konto die Nummer erfasst hat. */
export function setStamm(db: DbSchnittstelle, setNumber: string) {
  return db.get<SetStamm>(
    `SELECT ${SET.name} AS name, ${SET.jahr} AS year, ${SET.thema} AS theme,
           ${SET.teile} AS pieces, c.minifigs, c.image_url, c.image_local,
           ${SET.name} = 'Set ' || rs.set_num AND ${SET.jahr} IS NULL AND ${SET.thema} IS NULL
             AND ${SET.teile} IS NULL AS platzhalter
      FROM (SELECT $1::text AS nr) x
      ${setStammJoin('x.nr')}
      LEFT JOIN set_catalog c ON c.set_number = x.nr
     WHERE rs.set_num IS NOT NULL`,
    [setNumber],
  );
}

export function setKatalog(db: DbSchnittstelle, setNumber: string) {
  return db.get<SetStamm>(
    `SELECT ${SET.name} AS name, c.image_local, c.image_url, ${SET.jahr} AS year,
           ${SET.teile} AS pieces, ${SET.thema} AS theme, c.minifigs
      FROM rb_sets rs LEFT JOIN rb_themes rt ON rt.id = rs.theme_id
      LEFT JOIN set_catalog c ON c.set_number = rs.set_num
     WHERE rs.set_num = $1`,
    [setNumber],
  );
}

/** Nummern, nach denen schon gefragt wurde (catalog_cache); der Name steht in rb_sets. */
export function ersterKatalogTreffer(db: DbSchnittstelle, nummern: string[]) {
  return db.get<{ set_number: string; name: string | null }>(
    `SELECT cc.set_number, rs.name FROM catalog_cache cc
      LEFT JOIN rb_sets rs ON rs.set_num = cc.set_number WHERE cc.set_number = ANY($1) LIMIT 1`,
    [nummern],
  );
}

export function katalogCacheNachNummer(db: DbSchnittstelle, setNumber: string) {
  return ersterKatalogTreffer(db, [setNumber]);
}

export function katalogTeileDesSets(db: DbSchnittstelle, setNumber: string) {
  return db.all<KatalogTeil>(
    `SELECT c.part_number, c.color_id, ${blNummerSql('c.part_number')} AS bl_part_number,
            c.part_name, c.color_name, c.color_hex, c.image_url, c.image_local
       FROM set_parts_catalog c
       ${blJoin('c.part_number', 'part', null)}
      WHERE c.set_number = $1`,
    [setNumber],
  );
}

export function inventarTeileDesSets(db: DbSchnittstelle, invId: number) {
  return db.all<ListenTeil>(
    `SELECT ip.part_num AS part_number, ip.color_id, ip.quantity AS total_quantity, ip.is_spare,
              COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
              p.name AS part_name, p.part_img_url AS rb_image_url,
              c.name AS color_name, c.rgb AS color_hex, c.bl_color_id
         FROM rb_inventory_parts ip
         LEFT JOIN rb_parts      p ON p.part_num = ip.part_num
         LEFT JOIN rb_colors     c ON c.id       = ip.color_id
         LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
        WHERE ip.inventory_id = $1
          AND NOT ip.is_spare`,
    [invId],
  );
}

export function inventarFigurenDesSets(db: DbSchnittstelle, invId: number) {
  return db.all<{ fig_number: string; fig_name: string | null; quantity: number; image_url: string | null }>(
    `SELECT ip.part_num AS fig_number, ip.quantity, COALESCE(mc.fig_name, ip.part_num) AS fig_name, mc.image_url
         FROM rb_inventory_parts ip
         LEFT JOIN minifigs_catalog mc ON mc.fig_number = ip.part_num
        WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`,
    [invId],
  );
}

export function setImFeld(db: DbSchnittstelle, setNumber: string, blickfeld: number[]) {
  return db.get('SELECT 1 AS da FROM sets WHERE set_number = $1 AND user_id = ANY($2) LIMIT 1', [setNumber, blickfeld]);
}

export function setsMitMenge(db: DbSchnittstelle, uid: number) {
  return db.all<{ set_number: string; quantity: number }>(
    `SELECT s.set_number, ${mengeSkalar('s')} AS quantity FROM sets s WHERE s.user_id=$1 ORDER BY s.set_number ASC`,
    [uid],
  );
}

export function setDesKontos(db: DbSchnittstelle, uid: number, setNumber: string) {
  return db.get('SELECT 1 AS ok FROM sets WHERE user_id = $1 AND set_number = $2', [uid, setNumber]);
}

export function fuegeAnleitungEin(
  db: DbSchnittstelle,
  uid: number,
  setNumber: string,
  pfad: string,
  beschreibung: string | null,
  lokalerPfad: string,
) {
  return db.run(
    'INSERT INTO instructions (user_id,set_number,url,description,local_path) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [uid, setNumber, pfad, beschreibung, lokalerPfad],
  );
}

export function anleitungsPfad(db: DbSchnittstelle, id: string, uid: number) {
  return db.get<{ local_path: string | null }>('SELECT local_path FROM instructions WHERE id = $1 AND user_id = $2', [
    id,
    uid,
  ]);
}

export function loescheAnleitung(db: DbSchnittstelle, id: string, uid: number) {
  return db.run('DELETE FROM instructions WHERE id = $1 AND user_id = $2', [id, uid]);
}

export function anleitungsdateiBenutzt(db: DbSchnittstelle, pfad: string) {
  return db.get('SELECT 1 AS ok FROM instructions WHERE local_path = $1 LIMIT 1', [pfad]);
}
