'use strict';
/**
 * Populates shared set_parts_catalog and set_minifigs_catalog from CSV data
 * and downloads part images — runs in background after set import.
 * All data is user-independent and shared across all users.
 */
const db   = require('../db/database');
import { downloadFile } from '../clients/rebrickable';
import { generateThumb } from '../routes/thumbs';
// Pfade zentral auflösen — __dirname zeigt seit dem dist/-Build nicht mehr
// auf die Wurzel. Siehe utils/appPaths.ts.
const path = require('path');
const fs   = require('fs');

// Teilebilder — Figuren liegen getrennt (siehe utils/appPaths.ts).
const { PART_IMAGES_DIR: IMG_DIR } = require('../utils/appPaths');

async function syncSetCatalog(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const alt = setNumber.includes('-') ? setNumber.replace(/-\d+$/, '') : `${setNumber}-1`;

  // Check if catalog is already fully populated (has images)
  const existing = await db.get(
    `SELECT COUNT(*) AS total, COUNT(image_local) AS with_img
     FROM set_parts_catalog WHERE set_number=$1 OR set_number=$2`,
    [n, alt]
  ).catch(()=>null);
  const total   = parseInt(existing?.total || 0);
  const withImg = parseInt(existing?.with_img || 0);
  if (total > 0 && withImg >= total) {
    // All parts have local images — nothing to do
    return;
  }
  // Find inventory in CSV cache
  const inv = await db.get(
    'SELECT id FROM rb_inventories WHERE set_num=$1 OR set_num=$2 ORDER BY version DESC LIMIT 1',
    [n, alt]
  ).catch(()=>null);
  if (!inv) {
    return;
  }

  // Load parts from CSV cache
  const parts = await db.all(
    `SELECT ip.part_num AS part_number,
            COALESCE(m.bl_part_num, ip.part_num) AS bl_part_number,
            p.name AS part_name, ip.color_id,
            c.name AS color_name, c.rgb AS color_hex,
            COALESCE(NULLIF(p.part_img_url, '')) AS image_url,
            ip.quantity, ip.is_spare
     FROM rb_inventory_parts ip
     LEFT JOIN rb_parts p ON p.part_num = ip.part_num
     LEFT JOIN rb_colors c ON c.id = ip.color_id
     LEFT JOIN rb_bl_mapping m ON m.part_num = ip.part_num
     WHERE ip.inventory_id = $1
       AND (ip.is_spare IS NULL OR ip.is_spare IN ('f','false','False','0',''))`,
    [inv.id]
  ).catch(()=>[]);

  if (!parts.length) {
    // No parts in CSV cache yet — skip silently
    return;
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const { rebrickableBackgroundLimiter: rebrickableLimiter } = require('../utils/rateLimiter');

  let downloaded = 0;
  for (const p of parts) {
    let imageLocal: any = null;
    if (p.image_url) {
      const imgFile = `${p.part_number}_${p.color_id||0}.jpg`;
      const dest    = path.join(IMG_DIR, imgFile);
      const rel     = `/images/parts/${imgFile}`;

      if (fs.existsSync(dest)) {
        imageLocal = rel;
      } else {
        await rebrickableLimiter.waitForSlot();
        await downloadFile(p.image_url, dest).catch(()=>{});
        if (fs.existsSync(dest)) {
          await generateThumb(rel).catch(()=>{});
          imageLocal = rel;
          downloaded++;
        }
      }
    }

    if (total === 0) {
      // First time: full upsert
      await db.run(
        `INSERT INTO set_parts_catalog
           (set_number,part_number,bl_part_number,part_name,color_id,color_name,color_hex,image_url,image_local,quantity,is_spare)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET
           bl_part_number = COALESCE(EXCLUDED.bl_part_number, set_parts_catalog.bl_part_number),
           part_name      = COALESCE(EXCLUDED.part_name, set_parts_catalog.part_name),
           color_name     = COALESCE(EXCLUDED.color_name, set_parts_catalog.color_name),
           color_hex      = COALESCE(EXCLUDED.color_hex, set_parts_catalog.color_hex),
           image_url      = COALESCE(EXCLUDED.image_url, set_parts_catalog.image_url),
           image_local    = COALESCE(EXCLUDED.image_local, set_parts_catalog.image_local),
           quantity       = EXCLUDED.quantity, updated_at = NOW()`,
        [n, p.part_number, p.bl_part_number, p.part_name||'', p.color_id||0,
         p.color_name||'', p.color_hex||null, p.image_url||null, imageLocal, p.quantity||1, 0]
      ).catch(()=>{});
    } else if (imageLocal) {
      // Parts exist, just update image_local where missing
      await db.run(
        `UPDATE set_parts_catalog SET image_local=$1, updated_at=NOW()
         WHERE set_number=$2 AND part_number=$3 AND color_id=$4 AND image_local IS NULL`,
        [imageLocal, n, p.part_number, p.color_id||0]
      ).catch(()=>{});
    }
  }

  // Sync minifigs
  const figs = await db.all(
    `SELECT ip.part_num AS fig_number, ip.quantity,
            s.name AS fig_name, s.set_img_url AS image_url
     FROM rb_inventory_parts ip
     LEFT JOIN rb_sets s ON s.set_num = ip.part_num
     WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`,
    [inv.id]
  ).catch(()=>[]);

  for (const f of figs) {
    await db.run(
      `INSERT INTO set_minifigs_catalog (set_number,fig_number,fig_name,quantity,image_url)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (set_number,fig_number) DO UPDATE SET
         fig_name=EXCLUDED.fig_name, quantity=EXCLUDED.quantity,
         image_url=COALESCE(EXCLUDED.image_url, set_minifigs_catalog.image_url), updated_at=NOW()`,
      [n, f.fig_number, f.fig_name||'', f.quantity||1, f.image_url||null]
    ).catch(()=>{});
  }
}

// Sync all sets that are in rb_inventories but not yet in set_parts_catalog
async function syncAllMissing() {
  const sets = await db.all(
    `SELECT DISTINCT s.set_num FROM rb_sets s
     LEFT JOIN set_parts_catalog c ON c.set_number = s.set_num
     WHERE c.set_number IS NULL AND s.set_num NOT LIKE 'fig-%'
     LIMIT 50`
  ).catch(()=>[]);

  if (!sets.length) return;
  for (const s of sets) {
    await syncSetCatalog(s.set_num);
  }
}

export { syncSetCatalog, syncAllMissing };