import path from 'path';
import fs from 'fs';
import * as db from '../db/database';
import { PART_IMAGES_DIR } from './appPaths';
import { getAllSetParts, downloadFile, sleep } from '../clients/rebrickable';
import { logAndContinue, fehlertext } from './httpError';
import { generateThumb } from './thumbs';
import { meldeUndWeiter } from '../utils/httpError';
import { getGlobalSetting } from '../utils/settings';
import { mitVersion } from './setNummer';
import { merkeBlTeilnummer, merkeBlNummerUnveraendert } from './blZuordnung';

/**
 * Teile eines Sets aus dem Katalog übernehmen.
 *
 * ── Warum das nicht mehr in routes/parts.ts steht (Nachtrag 131) ────────────
 *
 * `addSet()` ruft `importPartsForSet()` — und das war der Grund, warum addSet
 * selbst nicht aus routes/sets.ts herauskam: Ein Modul unter utils/ hätte einen
 * ROUTER importieren müssen. Das ist die falsche Richtung; utils/ ist die
 * Schicht, auf der Routen aufsetzen, nicht umgekehrt.
 *
 * Die vier Funktionen hier sind reine Katalogarbeit ohne jede Route: Teile
 * holen, Bilder im Hintergrund nachladen, BrickLink-Nummern nachtragen. Sie
 * lagen in routes/parts.ts, weil die HTTP-Route dort steht, die sie auslöst.
 */

async function downloadPartImagesBackground(
  imageDownloads: { url: string; dest: string; partNumber: string; colorId: number | string }[],
  setNumber: string) {
  let done = 0;
  const BATCH = 10;
  for (let i = 0; i < imageDownloads.length; i += BATCH) {
    const batch = imageDownloads.slice(i, i + BATCH);
    await Promise.all(batch.map(async ({ url, dest, partNumber, colorId }:
      { url: string; dest: string; partNumber: string; colorId: number | string }) => {
      await downloadFile(url, dest).catch(() => {});
      // Nur weitermachen, wenn die Datei wirklich geschrieben wurde. Andernfalls
      // würde image_local auf eine nicht existierende Datei zeigen und in Web +
      // Android 404 liefern (z.B. bei bedruckten Teilen, deren CDN-Bild fehlt).
      // Ohne image_local fallen beide Clients automatisch auf die CDN-URL zurück.
      if (!fs.existsSync(dest)) return;
      const rel = '/images/parts/' + require('path').basename(dest);
      await generateThumb(rel).catch(() => {});
      // Sync image_local to shared catalog
      if (partNumber && colorId !== undefined) {
        await db.run(
          'UPDATE set_parts_catalog SET image_local=$1 WHERE part_number=$2 AND color_id=$3',
          [rel, partNumber, colorId]
        ).catch(logAndContinue('parts:image_local katalog'));
        await db.run(
          'UPDATE parts SET image_local=$1 WHERE part_number=$2 AND color_id=$3',
          [rel, partNumber, colorId]
        ).catch(logAndContinue('parts:image_local bestand'));
      }
    }));
    done += batch.length;
    await sleep(200);
  }
  if (done > 0) console.log(`[parts] ${setNumber}: ${done} Bilder`);
}

// Sync bl_part_number from rb_bl_mapping table (called after CSV sync)
async function syncBlPartNumbers() {
  // Sync to user parts table
  const r1 = await db.run(
    `UPDATE parts SET bl_part_number = m.bl_part_num
     FROM rb_bl_mapping m
     WHERE parts.part_number = m.part_num
       AND (parts.bl_part_number IS NULL OR parts.bl_part_number = parts.part_number)
       AND m.bl_part_num IS NOT NULL`
  ).catch(logAndContinue('teile:bl-nummern (Bestand)'));
  // Sync to shared catalog too
  const r2 = await db.run(
    `UPDATE set_parts_catalog SET bl_part_number = m.bl_part_num
     FROM rb_bl_mapping m
     WHERE set_parts_catalog.part_number = m.part_num
       AND (set_parts_catalog.bl_part_number IS NULL OR set_parts_catalog.bl_part_number = set_parts_catalog.part_number)
       AND m.bl_part_num IS NOT NULL`
  ).catch(logAndContinue('teile:bl-nummern (Katalog)'));
  // db.run() liefert { changes, lastID } — nicht rowCount. Hier stand
  // r1?.rowCount + r2?.rowCount, und die Summe war deshalb immer 0. Da sie
  // ausserdem nirgends verwendet wurde, war die ganze Zeile wirkungslos:
  // jetzt eine Logzeile, die tatsächlich etwas aussagt.
  const count = (r1?.changes || 0) + (r2?.changes || 0);
  if (count) console.log(`[parts] BrickLink-Nummern nachgetragen: ${count} Zeilen`);
}

// Der frühere `sendProgress`-Parameter ist ersatzlos entfallen, und mit ihm die
// Schritte 'parts_start', 'parts_importing', 'parts_done', 'parts_images' und
// 'parts_error'. NACHGEMESSEN: alle fünf Aufrufstellen (setService zweimal,
// routes/sets.ts zweimal, routes/parts.ts) übergaben `null`, seit der
// Teile-Import aus addSet() heraus in ein setTimeout gewandert ist. Die
// Ereignisse konnten den Browser also nicht mehr erreichen; der Fortschritts-
// dialog zeigte trotzdem Punkte dafür an. Beides ist jetzt weg.
async function importPartsForSet(setNumber: string, userId: number) {
  const n = mitVersion(setNumber);
  try {
    const rawParts = await getAllSetParts(n);
    if (!rawParts || rawParts.length === 0) return 0;

    const imgDir = PART_IMAGES_DIR;
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

    await db.run('DELETE FROM parts WHERE user_id = $1 AND set_number = $2', [userId, n]);

    const rows: any[] = [];
    const imageDownloads: any[] = [];
    for (const part of rawParts) {
      const p = part.part || {}, color = part.color || {};
      const partNo = p.part_num || ''; if (!partNo) continue;
      const colorId = color.id || 0, colorName = color.name || 'Unknown', colorHex = color.rgb || null;
      const catName = p.part_cat_id ? String(p.part_cat_id) : 'Unknown';
      const imageUrl = part.part_img_url || p.part_img_url || null;
      let localPath: any = null;
      if (imageUrl) {
        try {
          const ext = path.extname(new URL(imageUrl).pathname) || '.png';
          const imgFile = `${partNo}_${colorId}${ext}`;
          localPath = `/images/parts/${imgFile}`;
          const fullPath = path.join(imgDir, imgFile);
          if (!fs.existsSync(fullPath)) imageDownloads.push({ url: imageUrl, dest: fullPath });
        } catch (e) { meldeUndWeiter('teile-import:bildpfad', e); }
      }
      const blNum = p.external_ids?.BrickLink?.[0] || null; // null = not yet known
      rows.push([userId, n, partNo, blNum, p.name||'', colorId, colorName, colorHex, catName, part.quantity||1, imageUrl, localPath, part.is_spare?1:0]);
    }

    // Batch insert: user parts table + shared catalog
    if (rows.length > 0) {
      // Sort rows by part_number+color_id for consistent lock order (prevents deadlocks)
      rows.sort((a,b) => a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[5] - b[5]);

      // Retry up to 3 times on deadlock
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await db.transaction(async (tx) => {
            for (const row of rows) {
              // [0]=userId [1]=setNum [2]=partNo [3]=blNum [4]=name [5]=colorId [6]=colorName [7]=colorHex [8]=catName [9]=qty [10]=imageUrl [11]=imageLocal [12]=isSpare
              await tx.run(
                'INSERT INTO parts (user_id,set_number,part_number,bl_part_number,part_name,color_id,color_name,color_hex,category_name,quantity,image_url,image_local,is_spare) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING',
                row
              );
            }
            // Insert catalog separately (different table — avoids cross-table deadlock)
            for (const row of rows) {
              await tx.run(
                `INSERT INTO set_parts_catalog (set_number,part_number,bl_part_number,part_name,color_id,color_name,color_hex,category_name,image_url,image_local,is_spare,quantity)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET
                   bl_part_number=COALESCE(EXCLUDED.bl_part_number,set_parts_catalog.bl_part_number),
                   part_name=EXCLUDED.part_name,color_name=EXCLUDED.color_name,color_hex=EXCLUDED.color_hex,
                   image_url=COALESCE(EXCLUDED.image_url,set_parts_catalog.image_url),
                   image_local=COALESCE(EXCLUDED.image_local,set_parts_catalog.image_local),
                   quantity=EXCLUDED.quantity,updated_at=NOW()`,
                [row[1],row[2],row[3],row[4],row[5],row[6],row[7],row[8],row[10],row[11],row[12],row[9]]
              );
            }
          });
          break; // success
        } catch(e) {
          if (fehlertext(e)?.includes('deadlock') && attempt < 3) {
            console.warn(`[parts] Deadlock on ${n}, retry ${attempt}/3...`);
            await new Promise(r => setTimeout(r, 200 * attempt));
          } else throw e;
        }
      }
    }

    if (imageDownloads.length > 0) {
      setImmediate(() => downloadPartImagesBackground(imageDownloads, n));
    }

    console.log(`[parts] ${n}: ${rows.length} importiert`);
    return rows.length;
  } catch (e) {
    console.error(`Parts import failed for ${n}:`, fehlertext(e));
    return 0;
  }
}

// Fetch BL IDs for parts that have no mapping yet — runs in background, never blocks
async function fetchMissingBlIds() {
  const monitor = require('../utils/jobMonitor');
  try {
    const { rebrickableBackgroundLimiter: rebrickableLimiter, consumeRebrickableDaily } = require('../utils/rateLimiter');
    const rbKey = await getGlobalSetting('rebrickable_api_key');
    if (!rbKey) return;

    // Only fetch parts not yet in rb_bl_mapping (source of truth for BL IDs)
    const missing = await db.all(
      `SELECT DISTINCT p.part_number FROM parts p
       LEFT JOIN rb_bl_mapping m ON m.part_num = p.part_number
       WHERE m.part_num IS NULL
         AND p.part_number IS NOT NULL
         AND p.source != 'manual'
       LIMIT 5000`
    );
    if (!missing.length) return;

    monitor.update('blIds', { status: 'running', progress: 0, total: missing.length, sub: `0 / ${missing.length}` });

    // `as typeof import('https')` wie in Punkt 3: Ohne das ist die Rueckgabe
// von require() `any`, und damit auch der Antwort-Rueckruf `r`.
const https2 = require('https') as typeof import('https');
    const BATCH = 500;
    let serverErrors = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      if (!await consumeRebrickableDaily()) break;
      await rebrickableLimiter.waitForSlot();
      const batch = missing.slice(i, i + BATCH).map(r => r.part_number);
      const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${batch.join(',')}&page_size=500`;
      const result = await new Promise<{ status: number; body: string }>(resolve => {
        const req = https2.get(url, { family: 4, headers: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventory/1.0' } }, r => {
          let b = ''; r.on('data', (d: Buffer) => b += d);
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body: b }));
        });
        req.on('error', () => resolve({ status: 0, body: '' }));
        req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
      });
      if (result.status === 429) {
        const { parseThrottleWait: ptw } = require('../utils/rateLimiter');
        await new Promise(r => setTimeout(r, ptw(result.body)));
        i -= BATCH; continue;
      }
      if (result.status >= 500 || result.status === 0) {
        if (serverErrors++ === 0) { await new Promise(r => setTimeout(r, 10000)); i -= BATCH; continue; }
        else break;
      }
      if (result.status !== 200) continue;
      let data; try { data = JSON.parse(result.body); } catch(_) { continue; }
      const batchDone = i + BATCH;
      monitor.update('blIds', { status: 'running', progress: batchDone, sub: `${Math.min(batchDone, missing.length)} / ${missing.length}` });
      for (const part of (data?.results || [])) {
        const blIds = part.external_ids?.BrickLink;
        const blNum = Array.isArray(blIds) && blIds.length > 0 ? blIds[0] : part.part_num;
        await merkeBlTeilnummer(part.part_num, blNum).catch(() => {});
      }
      // Mark unmatched as checked
      const returned = new Set((data?.results||[]).map((p: { part_num: string }) => p.part_num));
      for (const pn of batch) {
        if (!returned.has(pn)) {
          await merkeBlNummerUnveraendert(pn).catch(() => {});
        }
      }
    }
    await syncBlPartNumbers();
    monitor.update('blIds', { status: 'done', sub: null });

  } catch(e) { console.error('[bl-fetch] error:', fehlertext(e)); }
}

export { importPartsForSet, fetchMissingBlIds, syncBlPartNumbers, downloadPartImagesBackground };
