'use strict';
/**
 * Backfills bl_part_number for all parts that have a Rebrickable part_number
 * but no BrickLink mapping yet.
 * Uses GET /api/v3/lego/parts/?part_nums=a,b,c (batch of 500) instead of single calls.
 */
const db      = require('../db/database');
const https   = require('https');
const { rebrickableBackgroundLimiter: rebrickableLimiter, consumeRebrickableDaily, parseThrottleWait } = require('../utils/rateLimiter');

import { merkeBlTeilnummer } from '../utils/blZuordnung';
import { getRbKey } from '../clients/rebrickable';

/** Ergebnis der handgebauten HTTPS-Aufrufe in dieser Datei. Ohne Typparameter
 *  leitet TypeScript bei `new Promise` `unknown` ab. */
type JobHttpResult = { status: number; body: string };


async function fetchBatch(partNums: string[], rbKey: string) {
  const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${partNums.join(',')}&page_size=500`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await rebrickableLimiter.waitForSlot();
    const result = await new Promise<JobHttpResult>(resolve => {
      const req = https.get(url, { family: 4, headers: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventory/1.0' } }, (r: any) => {
        let b = ''; r.on('data', (d: any) => b += d);
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body: b }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    });
    if (result.status === 429) {
      const wait = parseThrottleWait(result.body);
      console.log(`[bl-backfill] 429, waiting ${wait}ms...`);
      rebrickableLimiter.throttle(wait);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (result.status === 200) {
      try { return JSON.parse(result.body)?.results || []; } catch(_) { return []; }
    }
    return [];
  }
  return [];
}

async function run() {
  const rbKey = await getRbKey();
  if (!rbKey) { console.log('[bl-backfill] No Rebrickable API key — skipping'); return; }

  const parts = await db.all(
    `SELECT DISTINCT part_number FROM parts
     WHERE bl_part_number IS NULL
     ORDER BY part_number`
  );
  if (!parts.length) { console.log('[bl-backfill] All parts already have bl_part_number'); return; }

  const partNums = parts.map((p: any) => p.part_number);
  console.log(`[bl-backfill] Backfilling ${partNums.length} parts in batches of 500...`);
  const BATCH = 500;
  let updated = 0, skipped = 0;

  for (let i = 0; i < partNums.length; i += BATCH) {
    if (!await consumeRebrickableDaily()) {
      console.log('[bl-backfill] Daily limit reached — stopping');
      break;
    }
    const batch = partNums.slice(i, i + BATCH);
    const results = await fetchBatch(batch, rbKey);

    // Build map from API results
    const apiMap: any = {};
    for (const p of results) {
      const blId = p.external_ids?.BrickLink?.[0] || null;
      apiMap[p.part_num] = blId || p.part_num; // fallback to RB ID if no BL ID
    }

    // Update DB for all parts in this batch
    for (const partNum of batch) {
      const blId = apiMap[partNum] || partNum; // if not in API response, use RB ID
      await db.run(
        `UPDATE parts SET bl_part_number=$1 WHERE part_number=$2 AND bl_part_number IS NULL`,
        [blId, partNum]
      ).catch((e: any) => console.warn(`[bl-backfill] bl_part_number ${partNum}: ${e.message}`));
      await merkeBlTeilnummer(partNum, blId)
        .catch((e: any) => console.warn(`[bl-backfill] rb_bl_mapping ${partNum}: ${e.message}`));
      if (apiMap[partNum]) updated++; else skipped++;
    }
    console.log(`[bl-backfill] ${Math.min(i+BATCH, partNums.length)}/${partNums.length} done (${updated} updated)`);
  }
  console.log(`[bl-backfill] Done: ${updated} updated, ${skipped} skipped`);
}

export { run };