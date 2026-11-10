import type { Db, DbSchnittstelle } from '../../../db/database';
import type { PoolClient } from 'pg';
import { LOCKS } from '../../infra/lockNamespaces';
import { versucheSchluesselSperre, gibSchluesselSperreFrei } from '../../../db/txLock';

export type InventarTeil = { part_num: string; color_id: number | null; quantity: number };

export function teileDesInventars(db: DbSchnittstelle, inventarId: number) {
  return db.all<InventarTeil>(
    `SELECT ip.part_num, ip.color_id, ip.quantity
     FROM rb_inventory_parts ip
     WHERE ip.inventory_id = $1
       AND NOT ip.is_spare`, [inventarId]);
}

export function setTeileKatalog(db: DbSchnittstelle, setNumber: string) {
  return db.all<{ part_number: string; color_id: number; image_url: string | null; image_local: string | null }>(
    `SELECT part_number, color_id, image_url, image_local
     FROM set_parts_catalog WHERE set_number = $1`, [setNumber]);
}

/** Eine Zeile heisst „nachgesehen", auch mit leerer bl_id. */
export function blZuordnungen(db: DbSchnittstelle, teilnummern: string[]) {
  return db.all<{ rb_id: string; bl_id: string | null }>(
    `SELECT rb_id, bl_id FROM bl_zuordnung
     WHERE art = 'part' AND rb_id = ANY($1::text[])`, [teilnummern]);
}

export async function figurenImSetkatalog(db: DbSchnittstelle, setNumber: string): Promise<number> {
  const r = await db.get<{ c: string }>('SELECT COUNT(*) AS c FROM set_minifigs_catalog WHERE set_number = $1', [setNumber]);
  return parseInt(r?.c ?? '0') || 0;
}

export type Bildwunsch = { id: string; color_id: number; image_url: string; kind: 'part' | 'fig' };

export async function bilderOhneDatei(db: DbSchnittstelle, setNumber: string): Promise<Bildwunsch[]> {
  const [teile, figuren] = await Promise.all([
    db.all<Bildwunsch>(
      `SELECT part_number AS id, color_id, image_url, 'part' AS kind FROM set_parts_catalog
       WHERE set_number = $1 AND image_url IS NOT NULL AND image_local IS NULL`, [setNumber]),
    db.all<Bildwunsch>(
      `SELECT fig_number AS id, 0 AS color_id, image_url, 'fig' AS kind FROM set_minifigs_catalog
       WHERE set_number = $1 AND image_url IS NOT NULL AND image_local IS NULL`, [setNumber]),
  ]);
  return [...teile, ...figuren];
}

export function figurenDesSets(db: DbSchnittstelle, setNumber: string) {
  return db.all<{ fig_number: string; quantity: number }>(
    'SELECT fig_number, quantity FROM set_minifigs_catalog WHERE set_number = $1', [setNumber]);
}

export function inventareDerFiguren(db: DbSchnittstelle, figurnummern: string[]) {
  return db.all<{ set_num: string; id: number }>(
    `SELECT set_num, id FROM rb_inventories
     WHERE set_num = ANY($1::text[])
     ORDER BY version DESC`, [figurnummern]);
}

export function lokaleBilderMitAdresse(db: DbSchnittstelle) {
  return db.all<{ image_local: string; image_url: string | null }>(
    `SELECT image_local, MAX(image_url) AS image_url FROM (
       SELECT image_local, image_url FROM set_parts_catalog    WHERE image_local IS NOT NULL
       UNION ALL
       SELECT image_local, image_url FROM set_minifigs_catalog WHERE image_local IS NOT NULL
       UNION ALL
       SELECT image_local, image_url FROM part_color_catalog   WHERE image_local IS NOT NULL
       UNION ALL
       SELECT image_local, image_url FROM minifigs_catalog     WHERE image_local IS NOT NULL
       UNION ALL
       SELECT image_local, image_url FROM set_catalog          WHERE image_local IS NOT NULL
     ) t
     GROUP BY image_local`);
}

/** Ein nicht wiederherstellbares Bild wird hier geleert: Die Oberflächen fallen
 * auf die CDN-Adresse zurück. */
export const KATALOGE_MIT_BILD = ['part_color_catalog', 'minifigs_catalog', 'set_catalog'] as const;
export function vergissLokalesBild(db: DbSchnittstelle, katalog: typeof KATALOGE_MIT_BILD[number], imageLocal: string) {
  return db.run(`UPDATE ${katalog} SET image_local=NULL WHERE image_local=$1`, [imageLocal]);
}

/** Sperren und Freigeben müssen auf derselben Sitzung laufen; über den Pool
 * landeten sie auf verschiedenen. */
export function sperrVerbindung(db: Db): Promise<PoolClient> {
  return db.pool.connect();
}

export async function versucheBildSperre(c: PoolClient, setNumber: string): Promise<boolean> {
  return versucheSchluesselSperre(c, LOCKS.BILD_DOWNLOAD, setNumber);
}

export async function gibBildSperreFrei(c: PoolClient, setNumber: string): Promise<void> {
  await gibSchluesselSperreFrei(c, LOCKS.BILD_DOWNLOAD, setNumber);
}

export async function versucheNachlaufSperre(c: PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, 0) AS ok', [LOCKS.BILDER_NACHLAUF]);
  return !!rows[0]?.ok;
}

export async function gibNachlaufSperreFrei(c: PoolClient): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, 0)', [LOCKS.BILDER_NACHLAUF]);
}
