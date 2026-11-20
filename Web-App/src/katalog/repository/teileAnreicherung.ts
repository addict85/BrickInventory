import type { Db, DbInterface } from '../../../db/database';
import type { PoolClient } from 'pg';
import { LOCKS } from '../../infra/lockNamespaces';
import { attemptsKeyLock, giveKeyLockFree } from '../../../db/txLock';

export type InventoryPart = { part_num: string; color_id: number | null; quantity: number };

export function partsOfInventory(db: DbInterface, inventoryId: number) {
  return db.all<InventoryPart>(
    `SELECT ip.part_num, ip.color_id, ip.quantity
     FROM rb_inventory_parts ip
     WHERE ip.inventory_id = $1
       AND NOT ip.is_spare`,
    [inventoryId],
  );
}

export function setPartsCatalog(db: DbInterface, setNumber: string) {
  return db.all<{ part_number: string; color_id: number; image_url: string | null; image_local: string | null }>(
    `SELECT part_number, color_id, image_url, image_local
     FROM set_parts_catalog WHERE set_number = $1`,
    [setNumber],
  );
}

/** Eine Zeile heisst „nachgesehen", auch mit leerer bl_id. */
export function blMappings(db: DbInterface, partNumbers: string[]) {
  return db.all<{ rb_id: string; bl_id: string | null }>(
    `SELECT rb_id, bl_id FROM bl_mapping
     WHERE art = 'part' AND rb_id = ANY($1::text[])`,
    [partNumbers],
  );
}

export async function minifigsInSetkatalog(db: DbInterface, setNumber: string): Promise<number> {
  const r = await db.get<{ c: string }>('SELECT COUNT(*) AS c FROM set_minifigs_catalog WHERE set_number = $1', [
    setNumber,
  ]);
  return parseInt(r?.c ?? '0', 10) || 0;
}

export type ImageRequest = { id: string; color_id: number; image_url: string; kind: 'part' | 'fig' };

export async function imagesWithoutFile(db: DbInterface, setNumber: string): Promise<ImageRequest[]> {
  const [teile, figuren] = await Promise.all([
    db.all<ImageRequest>(
      `SELECT part_number AS id, color_id, image_url, 'part' AS kind FROM set_parts_catalog
       WHERE set_number = $1 AND image_url IS NOT NULL AND image_local IS NULL`,
      [setNumber],
    ),
    db.all<ImageRequest>(
      `SELECT fig_number AS id, 0 AS color_id, image_url, 'fig' AS kind FROM set_minifigs_catalog
       WHERE set_number = $1 AND image_url IS NOT NULL AND image_local IS NULL`,
      [setNumber],
    ),
  ]);
  return [...teile, ...figuren];
}

export function minifigsOfSets(db: DbInterface, setNumber: string) {
  return db.all<{ fig_number: string; quantity: number }>(
    'SELECT fig_number, quantity FROM set_minifigs_catalog WHERE set_number = $1',
    [setNumber],
  );
}

export function inventoriesTheMinifigs(db: DbInterface, figurnummern: string[]) {
  return db.all<{ set_num: string; id: number }>(
    `SELECT set_num, id FROM rb_inventories
     WHERE set_num = ANY($1::text[])
     ORDER BY version DESC`,
    [figurnummern],
  );
}

export function localImagesWithAddress(db: DbInterface) {
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
     GROUP BY image_local`,
  );
}

/** Ein nicht wiederherstellbares Bild wird hier geleert: Die Oberflächen fallen
 * auf die CDN-Adresse zurück. */
export const CATALOGS_WITH_IMAGE = ['part_color_catalog', 'minifigs_catalog', 'set_catalog'] as const;
export function forgetLocalImage(db: DbInterface, katalog: (typeof CATALOGS_WITH_IMAGE)[number], imageLocal: string) {
  return db.run(`UPDATE ${katalog} SET image_local=NULL WHERE image_local=$1`, [imageLocal]);
}

/** Sperren und Freigeben müssen auf derselben Sitzung laufen; über den Pool
 * landeten sie auf verschiedenen. */
export function lockConnection(db: Db): Promise<PoolClient> {
  return db.pool.connect();
}

export async function attemptsImageLock(c: PoolClient, setNumber: string): Promise<boolean> {
  return attemptsKeyLock(c, LOCKS.IMAGE_DOWNLOAD, setNumber);
}

export async function giveImageLockFree(c: PoolClient, setNumber: string): Promise<void> {
  await giveKeyLockFree(c, LOCKS.IMAGE_DOWNLOAD, setNumber);
}

export async function attemptsFollowUpLock(c: PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, 0) AS ok', [LOCKS.IMAGES_FOLLOW_UP]);
  return !!rows[0]?.ok;
}

export async function giveFollowUpLockFree(c: PoolClient): Promise<void> {
  await c.query('SELECT pg_advisory_unlock($1, 0)', [LOCKS.IMAGES_FOLLOW_UP]);
}
