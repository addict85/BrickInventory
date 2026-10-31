'use strict';
/**
 * Backfills bl_part_number for all parts that have a Rebrickable part_number
 * but no BrickLink mapping yet.
 * Uses GET /api/v3/lego/parts/?part_nums=a,b,c (batch of 500) instead of single calls.
 */

import { merkeBlNummer } from '../src/katalog/blZuordnung';
import { getRbKey } from '../clients/rebrickable';
import { nummernListe } from '../src/infra/fremdeAdressen';
import * as db from '../db/database';
import https from 'https';
import { rebrickableBackgroundLimiter as rebrickableLimiter, consumeRebrickableDaily, parseThrottleWait } from '../src/katalog/rateLimiter';

/** Ergebnis der handgebauten HTTPS-Aufrufe in dieser Datei. Ohne Typparameter
 *  leitet TypeScript bei `new Promise` `unknown` ab. */
type JobHttpResult = { status: number; body: string };


async function fetchBatch(partNums: string[], rbKey: string) {
  const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(partNums)}&page_size=500`;
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

  // „Noch keine Zeile in bl_zuordnung" statt „Spalte leer" (Migration
  // 0037). Geprueft wird die ZEILE, nicht ihr Wert: leer heisst
  // nachgesehen und ohne abweichende Nummer, und das soll kein zweites
  // Nachladen ausloesen.
  const parts = await db.all(
    `SELECT DISTINCT p.part_number FROM parts p
      LEFT JOIN bl_zuordnung z ON z.art = 'part' AND z.rb_id = p.part_number
      WHERE z.rb_id IS NULL
      ORDER BY p.part_number`
  );
  if (!parts.length) { console.log('[bl-backfill] Alle Teile sind nachgesehen'); return; }

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
      // EIN Schreibvorgang statt zwei: Hier stand zuerst ein
      // `UPDATE parts SET bl_part_number=...` und danach derselbe Wert noch
      // einmal in die Zuordnung. Mit Migration 0037 gibt es die Spalte nicht
      // mehr — und damit auch nicht mehr die Frage, welcher der beiden
      // Schreibvorgänge gilt, wenn einer von ihnen ausfällt.
      await merkeBlNummer('part', partNum, blId)
        .catch((e: any) => console.warn(`[bl-backfill] bl_zuordnung ${partNum}: ${e.message}`));
      if (apiMap[partNum]) updated++; else skipped++;
    }
    console.log(`[bl-backfill] ${Math.min(i+BATCH, partNums.length)}/${partNums.length} done (${updated} updated)`);
  }
  console.log(`[bl-backfill] Done: ${updated} updated, ${skipped} skipped`);
}

export { run };