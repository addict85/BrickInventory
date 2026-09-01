'use strict';
/**
 * Enriches set_parts_catalog from Rebrickable API.
 * Logic:
 * 1. Check if all parts for the set are in set_parts_catalog with image_url
 * 2. If not: call /lego/sets/{set_num}/parts/ API (paginated)
 * 3. Save all parts to set_parts_catalog immediately
 * 4. For each part: if image already local → use it; else return CDN URL and download in background
 */
const db    = require('../db/database');
import { cdnImageLimiter } from '../utils/rateLimiter';
import { meldeUndWeiter, fehlertext } from '../utils/httpError';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
// Pfade zentral auflösen — __dirname zeigt seit dem dist/-Build nicht mehr
// auf die Wurzel. Siehe utils/appPaths.ts.
const { APP_ROOT, DATA_DIR, PUBLIC_DIR } = require('../utils/appPaths');

/** Ergebnis der handgebauten HTTPS-Aufrufe in dieser Datei. Ohne Typparameter
 *  leitet TypeScript bei `new Promise` `unknown` ab. */
type JobHttpResult = { status: number; body: string };

// Teile- und Figurenbilder liegen seit der Neuordnung getrennt (siehe
// utils/appPaths.ts). downloadImage() bekommt deshalb die Art mitgegeben —
// vorher landete beides im selben Ordner "part_images", was den Namen für die
// Hälfte des Inhalts falsch machte.
const { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } = require('../utils/appPaths');

async function getRbKey() {
  const row = await db.get("SELECT value FROM global_settings WHERE key='rebrickable_api_key'").catch(() => null);
  return row?.value || null;
}

async function apiGet(url: string, rbKey: string) {
  const { rebrickableBackgroundLimiter: rebrickableLimiter, consumeRebrickableDaily, parseThrottleWait } = require('../utils/rateLimiter');
  let serverErrors = 0;
  while (true) {
    if (!await consumeRebrickableDaily()) return null;
    await rebrickableLimiter.waitForSlot();
    const result = await new Promise<JobHttpResult>(resolve => {
      const req = https.get(url, {
        family: 4,   // Server hat keine IPv6-Route (bestätigt), siehe server.ts _cdnAgent
        headers: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventory/1.0' }
      }, (r: import('http').IncomingMessage) => {
        let b = ''; r.on('data', d => b += d);
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body: b }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    });
    if (result.status === 429) {
      const { parseThrottleWait: ptw } = require('../utils/rateLimiter');
      const wait = ptw(result.body);
      rebrickableLimiter.throttle(wait);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (result.status >= 500 || result.status === 0) {
      if (serverErrors++ === 0) { await new Promise(r => setTimeout(r, 10000)); continue; }
      return null;
    }
    if (result.status !== 200) return null;
    try { return JSON.parse(result.body); } catch(_) { return null; }
  }
}

// Download image to local file, return local path or null
/**
 * Bild herunterladen und lokal ablegen.
 *
 * @param {string} imgUrl
 * @param {string} partNum Teile- oder Figurennummer
 * @param {number} colorId
 * @param {'part'|'minifig'} kind Bestimmt Zielverzeichnis und Web-Pfad.
 *        Bewusst OHNE Vorgabewert: Ein stiller Standard 'part' hätte einen
 *        vergessenen Aufruf für Minifiguren unbemerkt in den falschen Ordner
 *        schreiben lassen — genau der Fehler, den die Trennung beheben sollte.
 */
// Rueckgabetyp ausgeschrieben (Nachtrag 155): Das `new Promise(...)` weiter
// unten hatte keinen Typparameter, damit leitete TypeScript `unknown` ab und
// die Funktion lieferte in der Summe `string | null | {}`. Aufgefallen ist das
// erst, als server.ts diese Datei nicht mehr als rohes require() (also `any`)
// holte: Dort wird das Ergebnis an generateThumb(webPfad: string) gereicht.
// Jedes resolve() hier drin liefert entweder den Web-Pfad oder null — genau
// das steht jetzt da.
async function downloadImage(
  imgUrl: string | null | undefined,
  partNum: string,
  colorId: number,
  kind: 'part' | 'minifig',
): Promise<string | null> {
  if (!imgUrl) return null;
  const IMG_DIR = kind === 'minifig' ? MINIFIG_IMAGES_DIR : PART_IMAGES_DIR;
  const webBase = kind === 'minifig' ? '/images/minifigs/' : '/images/parts/';
  fs.mkdirSync(IMG_DIR, { recursive: true });
  // ?. statt Behauptung: pop() liefert laut Typ `string | undefined`. Bei einem
  // nicht-leeren imgUrl (die Wache oben) kann das nie eintreten — beweisen
  // laesst es sich aber nicht, und der Rueckfall auf 'jpg' stand ohnehin schon da.
  const ext  = (imgUrl.split('.').pop()?.split('/')[0] || 'jpg').substring(0, 4);
  const file = `${partNum}_${colorId}.${ext}`;
  const dest = path.join(IMG_DIR, file);
  const rel  = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  return new Promise<string | null>(resolve => {
    const req = https.get(imgUrl, { family: 4, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer':    'https://rebrickable.com/',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    } }, (r: import('http').IncomingMessage) => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      const out = fs.createWriteStream(dest);
      r.pipe(out);
      out.on('finish', async () => {
        try { await require('../routes/thumbs').generateThumb(rel).catch(() => {}); } catch (e) { meldeUndWeiter('teile-enrich:vorschau', e); }
        resolve(rel);
      });
      out.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}

async function enrichSetParts(setNumber: string) {
  const n   = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const alt = n.replace(/-\d+$/, '');

  // Step 1: Check if all CSV parts are already in catalog with image_url
  const inv = await db.get(
    'SELECT id FROM rb_inventories WHERE set_num=$1 OR set_num=$2 ORDER BY version DESC LIMIT 1',
    [n, alt]
  ).catch(() => null);
  if (!inv) return;

  const csvParts = await db.all(
    `SELECT ip.part_num, ip.color_id, ip.quantity
     FROM rb_inventory_parts ip
     WHERE ip.inventory_id = $1
       AND (ip.is_spare IS NULL OR ip.is_spare IN ('f','false','False','0',''))`,
    [inv.id]
  );
  if (!csvParts.length) return;

  const catalogRows = await db.all(
    `SELECT part_number, color_id, image_url, image_local, bl_part_number
     FROM set_parts_catalog WHERE set_number=$1 OR set_number=$2`,
    [n, alt]
  );
  const catalogMap: any = {};
  for (const r of catalogRows) catalogMap[`${r.part_number}|${r.color_id}`] = r;

  // Get all part_nums already in rb_bl_mapping (= already looked up via API)
  const lookedUp = await db.all(
    `SELECT part_num FROM rb_bl_mapping WHERE part_num = ANY($1::text[])`,
    [csvParts.map((p: { part_num: string }) => p.part_num)]
  ).catch(() => []);
  const lookedUpSet = new Set(lookedUp.map((r: { part_num: string }) => r.part_num));

  // Only re-enrich parts NOT yet in rb_bl_mapping (never looked up)
  const missing = csvParts.filter((p: { part_num: string; color_id: number | string; [k: string]: any }) => {
    const cat = catalogMap[`${p.part_num}|${p.color_id}`];
    if (!cat) return true;                    // not in catalog at all
    if (!cat.bl_part_number) return true;     // in catalog but no BL ID
    if (!lookedUpSet.has(p.part_num)) return true; // never looked up via API
    return false;                             // has BL ID and was looked up → skip
  });
  
  if (!missing.length) {
    
    return; // All parts have correct BL IDs — skip API call
  }

  // Get API key once — needed for both parts and minifigs
  const rbKey = await getRbKey();
  if (!rbKey) { console.log('[parts-enrich] No API key'); return; }

  if (missing.length > 0) {
    // Step 2: Fetch all parts for this set from API

    const apiParts: any = {}; // key: "part_num|color_id"
    let url = `https://rebrickable.com/api/v3/lego/sets/${n}/parts/?page_size=500&inc_part_details=1`;
    while (url) {
      const data = await apiGet(url, rbKey);
      if (!data) break;
      for (const item of (data.results || [])) {
        const p = item.part, c = item.color;
        if (!p || !c) continue;
        apiParts[`${p.part_num}|${c.id}`] = {
          part_name:    p.name,
          bl_part_num:  p.external_ids?.BrickLink?.[0] || null,
          image_url:    p.part_img_url || null,
          color_name:   c.name,
          color_hex:    c.rgb,
          quantity:     item.quantity
        };
      }
      url = data.next || null;
    }

    // Step 3b: Batch-fetch BL IDs via /lego/parts/?part_nums= (most reliable source)
    // Use ALL unique part_nums from CSV (not just from apiParts which may be incomplete)
    const missingBl = [...new Set(csvParts.map((p: { part_num: string }) => p.part_num))];
    if (missingBl.length > 0) {
      
      const BATCH = 500;
      for (let i = 0; i < missingBl.length; i += BATCH) {
        const batch = missingBl.slice(i, i + BATCH);
        const blUrl = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${batch.join(',')}&page_size=500`;
        const blData = await apiGet(blUrl, rbKey);
        if (!blData) continue;
        for (const part of (blData.results || [])) {
          const blId = part.external_ids?.BrickLink?.[0] || null;
          
          if (blId) {
            // Update all entries for this part_num
            for (const colorId of Object.keys(apiParts)
              .filter(k => k.startsWith(part.part_num + '|'))
              .map(k => k.split('|')[1])) {
              const key = `${part.part_num}|${colorId}`;
              if (apiParts[key]) apiParts[key].bl_part_num = blId;
            }
            // Also store in rb_bl_mapping for future use
            await db.run(
              `INSERT INTO rb_bl_mapping (part_num, bl_part_num)
               VALUES ($1, $2)
               ON CONFLICT (part_num) DO UPDATE SET bl_part_num=$2, fetched_at=NOW()`,
              [part.part_num, blId]
            ).catch(() => {});
          }
        }
      }
    }

    // Build blMap from rb_bl_mapping for all csvParts (includes what we just fetched)
    const blMapRows = await db.all(
      `SELECT part_num, bl_part_num FROM rb_bl_mapping
       WHERE part_num = ANY($1::text[])`,
      [csvParts.map((p: { part_num: string }) => p.part_num)]
    ).catch(() => []);
    const blMap: any = {};
    for (const r of blMapRows) blMap[r.part_num] = r.bl_part_num;

    // Step 3: Save all CSV parts to catalog with API data
    for (const p of csvParts) {
      const key  = `${p.part_num}|${p.color_id}`;
      const info = apiParts[key] || {};
      // BL ID: from API response, then from rb_bl_mapping (just updated), then null
      const blPartNum = info.bl_part_num || blMap[p.part_num] || null;
      await db.run(
        `INSERT INTO set_parts_catalog
           (set_number, part_number, bl_part_number, part_name, color_id, color_name, color_hex, image_url, quantity, is_spare)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET
           bl_part_number = CASE WHEN EXCLUDED.bl_part_number IS NOT NULL THEN EXCLUDED.bl_part_number ELSE set_parts_catalog.bl_part_number END,
           part_name      = COALESCE(EXCLUDED.part_name,  set_parts_catalog.part_name),
           color_name     = COALESCE(EXCLUDED.color_name, set_parts_catalog.color_name),
           color_hex      = COALESCE(EXCLUDED.color_hex,  set_parts_catalog.color_hex),
           image_url      = COALESCE(EXCLUDED.image_url,  set_parts_catalog.image_url),
           quantity       = EXCLUDED.quantity, updated_at = NOW()`,
        [n, p.part_num, blPartNum, info.part_name||p.part_num,
         p.color_id||0, info.color_name||'', info.color_hex||null,
         info.image_url||null, p.quantity||1, 0]
      ).catch(() => {});
      // Refresh catalogMap
      catalogMap[key] = { image_url: info.image_url||null, image_local: null };
    }
  }

  // Fetch minifigs — always refresh from API if catalog is empty
  const existingFigs = await db.get(
    'SELECT COUNT(*) AS c FROM set_minifigs_catalog WHERE set_number=$1 OR set_number=$2',
    [n, alt]
  ).catch(() => null);

  if (!parseInt(existingFigs?.c || 0)) {
    const figsData = await apiGet(
      `https://rebrickable.com/api/v3/lego/sets/${n}/minifigs/?page_size=100`,
      rbKey
    );
    if (figsData?.results?.length) {
      for (const item of figsData.results) {
        // API fields: set_num, set_name, quantity, set_img_url
        await db.run(
          `INSERT INTO set_minifigs_catalog (set_number, fig_number, fig_name, quantity, image_url)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (set_number, fig_number) DO UPDATE SET
             fig_name  = COALESCE(EXCLUDED.fig_name, set_minifigs_catalog.fig_name),
             quantity  = EXCLUDED.quantity,
             image_url = COALESCE(EXCLUDED.image_url, set_minifigs_catalog.image_url),
             updated_at = NOW()`,
          [n, item.set_num, item.set_name||item.set_num, item.quantity||1, item.set_img_url||null]
        ).catch((e: Error) => console.error('[parts-enrich] minifig insert error:', e.message));
      }
      
    }
    // No minifigs = normal for Technic/City sets without figures
  } else {
    // Already in catalog — skip
  }
}

// Download images for a set in background (called after API enrichment)
// Per-set download lock: prevents concurrent downloadSetImages calls for the same set
const _downloadLocks = new Map();

async function downloadSetImages(setNumber: string, waitIfBusy = false) {
  const n   = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const alt = n.replace(/-\d+$/, '');

  // If already downloading this set, wait for it to finish then return
  if (_downloadLocks.has(n)) {
    await _downloadLocks.get(n);
    return;
  }
  // `!` ist hier BEWEISBAR und keine Beschwichtigung: Der Rumpf eines
  // Promise-Konstruktors laeuft laut Spezifikation SYNCHRON, resolveLock ist
  // also gesetzt, bevor irgendeine Zeile darunter laeuft. Ein `?.()`
  // stattdessen waere eine stille Wache vor einem Fall, den es nicht gibt.
  let resolveLock!: () => void;
  const lock = new Promise<void>(r => { resolveLock = r; });
  _downloadLocks.set(n, lock);

  // Cross-worker Lock: verhindert, dass zwei Cluster-Worker (z. B. der
  // Primary-Job UND der Add-Flow auf einem Request-Worker) dieselben
  // Set-Bilder gleichzeitig laden. Advisory-Lock auf einer DEDIZIERTEN
  // Verbindung, damit acquire/release auf derselben Session laufen (ein über
  // den Pool geholter Lock würde beim Idle-Timeout unzuverlässig freigegeben).
  let lockClient: import('pg').PoolClient | null = null, haveXlock = false;
  try { lockClient = await db.pool.connect(); } catch (_) { lockClient = null; }
  if (lockClient) {
    // waitIfBusy=true (z. B. PDF-Erzeugung): auf den anderen Worker WARTEN, bis
    // dessen Download fertig ist — sonst würde das PDF mit unvollständigen
    // Bildern erzeugt. waitIfBusy=false (Hintergrund-Job/Add-Flow): überspringen.
    const deadline = Date.now() + 180000; // max. 3 Min auf anderen Worker warten
    while (true) {
      try {
        const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [LOCKS.BILD_DOWNLOAD, n]);
        haveXlock = !!rows[0]?.ok;
      } catch (_) { haveXlock = false; }
      if (haveXlock) break;
      if (!waitIfBusy) {
        console.log(`[img-dl] ${n}: wird bereits von einem anderen Worker geladen — übersprungen`);
        lockClient.release();
        resolveLock();
        _downloadLocks.delete(n);
        return;
      }
      if (Date.now() > deadline) {
        console.warn(`[img-dl] ${n}: Wartezeit auf anderen Worker überschritten — fahre ohne Lock fort`);
        break; // best effort ohne Lock weitermachen
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const monitor = require('../utils/jobMonitor');
  let _pendingAdded = 0;  // Anteil dieses Batches am globalen imgDl-Zähler
  let _flushed      = 0;  // davon bereits an den Zähler gemeldet (Rest im finally)
  let _lastFlush    = Date.now();
  try {
    // Fetch both part images AND minifig images that still need downloading
    const [needsParts, needsFigs] = await Promise.all([
      db.all(
        `SELECT part_number AS id, color_id, image_url, 'part' AS kind FROM set_parts_catalog
         WHERE (set_number=$1 OR set_number=$2) AND image_url IS NOT NULL AND image_local IS NULL`,
        [n, alt]
      ),
      db.all(
        `SELECT fig_number AS id, 0 AS color_id, image_url, 'fig' AS kind FROM set_minifigs_catalog
         WHERE (set_number=$1 OR set_number=$2) AND image_url IS NOT NULL AND image_local IS NULL`,
        [n, alt]
      )
    ]);

    const needsImg = [...needsParts, ...needsFigs];
    if (!needsImg.length) return;

    console.log(`[img-dl] ${n}: lade ${needsImg.length} Bilder`);
    // Diesen Batch zum globalen Zähler ADDIEREN (über alle Sets/Worker summiert,
    // im finally wieder abgezogen) — statt den Monitor-Wert zu überschreiben,
    // sonst zeigt das Monitoring nur den zuletzt gestarteten Batch statt der Summe.
    _pendingAdded = needsImg.length;
    await monitor.imgDlAdd(_pendingAdded).catch(() => {});

    async function processOne(p: { part_number: string; image_url?: string | null; [k: string]: any }) {
      const rawUrl = p.image_url || '';
      let cdnUrl = rawUrl;
      const m = rawUrl.match(/\/api\/img-proxy\?url=(.+)/);
      if (m) cdnUrl = decodeURIComponent(m[1]);
      if (!cdnUrl.startsWith('http')) {
        console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
        return;
      }

      // `?? ''` ist unerreichbar und trotzdem richtig: String.split gibt nie
      // ein leeres Array zurueck (''.split('.') ist ['']), pop() kann hier
      // also nicht undefined werden. Der Uebersetzer weiss das nicht, und
      // ein `!` waere eine Behauptung statt einer Ableitung.
      const ext  = ((cdnUrl.split('.').pop() ?? '').split('?')[0].split('/')[0] || 'jpg').substring(0, 4).toLowerCase();
      const file = p.kind === 'fig'
        ? `${p.id.replace(/[^a-z0-9-]/gi, '_')}.${ext}`
        : `${p.id}_${p.color_id}.${ext}`;
      const dest = path.join(PART_IMAGES_DIR, file);
      const rel  = `/images/parts/${file}`;

      if (!fs.existsSync(dest)) {
        await cdnImageLimiter.acquire();
        const ok = await new Promise(resolve => {
          const req = https.get(cdnUrl, { family: 4, headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer':    'https://rebrickable.com/',
            'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          } }, (r: import('http').IncomingMessage) => {
            if (r.statusCode !== 200) {
              r.resume();
              console.warn(`[img-dl] HTTP ${r.statusCode} for ${p.id}: ${cdnUrl.substring(0, 80)}`);
              cdnImageLimiter.release();
              return resolve(false);
            }
            fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
            const out = fs.createWriteStream(dest);
            r.pipe(out);
            out.on('finish', () => { cdnImageLimiter.release(); resolve(true); });
            out.on('error',  (e: Error) => { console.warn(`[img-dl] write error for ${p.id}: ${e.message}`); cdnImageLimiter.release(); resolve(false); });
          });
          req.on('error', (e: Error) => { console.warn(`[img-dl] request error for ${p.id}: ${e.message}`); cdnImageLimiter.release(); resolve(false); });
          req.setTimeout(15000, () => { req.destroy(); console.warn(`[img-dl] timeout for ${p.id}`); cdnImageLimiter.release(); resolve(false); });
        });
        if (!ok) return;
      }

      if (p.kind === 'fig') {
        await db.run(
          `UPDATE set_minifigs_catalog SET image_local=$1
           WHERE (set_number=$2 OR set_number=$3) AND fig_number=$4`,
          [rel, n, alt, p.id]
        ).catch(() => {});
      } else {
        await db.run(
          `UPDATE set_parts_catalog SET image_local=$1
           WHERE (set_number=$2 OR set_number=$3) AND part_number=$4 AND color_id=$5`,
          [rel, n, alt, p.id, p.color_id]
        ).catch(() => {});
      }
    }

    let done = 0;
    // Fortschritt gebündelt an den globalen Zähler melden: höchstens ~1 DB-Write
    // pro Sekunde statt einer pro Bild. Das entlastet den Connection-Pool bei
    // Massen-Importen deutlich; der Live-Countdown bleibt praktisch gleich flüssig.
    // Der Zähler wird VOR dem await erhöht, damit gleichzeitige Aufrufe nicht
    // doppelt melden.
    const flushProgress = async (force?: boolean) => {
      const delta = done - _flushed;
      if (delta <= 0) return;
      if (!force && Date.now() - _lastFlush < 1000) return;
      _flushed  += delta;
      _lastFlush = Date.now();
      await monitor.imgDlAdd(-delta).catch(() => {});
    };
    await Promise.all(needsImg.map(async p => {
      await processOne(p);
      done++;
      await flushProgress(false);
    }));
    await flushProgress(true);
    console.log(`[img-dl] ${n}: ${done}/${needsImg.length} Bilder geladen`);

  } finally {
    // Nur den noch nicht gemeldeten Rest verrechnen — deckt Fehler/Abbruch ab,
    // ohne bei Normalablauf doppelt zu dekrementieren.
    const _rest = _pendingAdded - _flushed;
    if (_rest > 0) await monitor.imgDlAdd(-_rest).catch(() => {});
    if (lockClient) {
      if (haveXlock) await lockClient.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCKS.BILD_DOWNLOAD, n]).catch(() => {});
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

// Enrich all minifigs for a set in one batch
async function enrichSetMinifigs(setNumber: string) {
  const n   = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const alt = n.replace(/-\d+$/, '');
  const rbKey = await getRbKey();
  if (!rbKey) return;

  // Get all minifigs for this set
  const figs = await db.all(
    `SELECT fig_number, quantity FROM set_minifigs_catalog
     WHERE set_number=$1 OR set_number=$2`,
    [n, alt]
  ).catch(() => []);
  if (!figs.length) return;

  // Get all rb_inventories for these minifigs
  const figNums = figs.map((f: { fig_number: string }) => f.fig_number);
  const invRows = await db.all(
    `SELECT set_num, id FROM rb_inventories
     WHERE set_num = ANY($1::text[])
     ORDER BY version DESC`,
    [figNums]
  ).catch(() => []);

  // Deduplicate by set_num (keep highest version = first due to ORDER BY DESC)
  const invMap: any = {};
  for (const r of invRows) {
    if (!invMap[r.set_num]) invMap[r.set_num] = r.id;
  }

  // Collect ALL part_nums across all minifigs
  const allPartNums = new Set();
  const figPartsMap: any = {}; // fig_number -> [{part_num, color_id, quantity}]

  for (const fig of figs) {
    const invId = invMap[fig.fig_number];
    if (!invId) continue;

    const parts = await db.all(
      `SELECT ip.part_num, ip.color_id, ip.quantity
       FROM rb_inventory_parts ip
       WHERE ip.inventory_id = $1
         AND (ip.is_spare IS NULL OR ip.is_spare IN ('f','false','False','0',''))`,
      [invId]
    ).catch(() => []);

    figPartsMap[fig.fig_number] = { parts, figQty: fig.quantity };
    parts.forEach((p: { part_num: string }) => allPartNums.add(p.part_num));
  }

  if (!allPartNums.size) return;

  // Check which parts already have correct BL IDs in catalog
  const existingBl = await db.all(
    `SELECT part_number, color_id, bl_part_number
     FROM set_parts_catalog
     WHERE part_number = ANY($1::text[])
       AND bl_part_number IS NOT NULL
       AND bl_part_number != part_number`,
    [[...allPartNums]]
  ).catch(() => []);
  const existingBlMap: any = {};
  for (const r of existingBl) existingBlMap[`${r.part_number}|${r.color_id}`] = r.bl_part_number;

  // Also check rb_bl_mapping
  const rbBlRows = await db.all(
    `SELECT part_num, bl_part_num FROM rb_bl_mapping
     WHERE part_num = ANY($1::text[])`,
    [[...allPartNums]]
  ).catch(() => []);
  const rbBlMap: Record<string, string> = {};
  for (const r of rbBlRows) rbBlMap[r.part_num] = r.bl_part_num;

  // Find part_nums NOT yet in rb_bl_mapping (= never looked up via API)
  const needsBl = [...allPartNums].filter((pn: any) => !(String(pn) in rbBlMap));

  let apiBlMap: Record<string, string> = {};
  if (needsBl.length > 0) {
    
    const BATCH = 500;
    for (let i = 0; i < needsBl.length; i += BATCH) {
      const batch = needsBl.slice(i, i + BATCH);
      const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${batch.join(',')}&page_size=500`;
      const data = await apiGet(url, rbKey);
      if (!data) continue;
      for (const p of (data.results || [])) {
        const blId = p.external_ids?.BrickLink?.[0] || null;
        const finalId = blId || p.part_num;
        apiBlMap[p.part_num] = finalId;
        
        // Persist to rb_bl_mapping
        await db.run(
          `INSERT INTO rb_bl_mapping (part_num, bl_part_num)
           VALUES ($1,$2) ON CONFLICT (part_num) DO UPDATE SET bl_part_num=$2, fetched_at=NOW()`,
          [p.part_num, finalId]
        ).catch(() => {});
      }
    }
  }

  // Merge: apiBlMap > rbBlMap > part_num
  const finalBlMap: Record<string, string> = {};
  for (const pn of allPartNums as Iterable<string>) {
    finalBlMap[pn] = apiBlMap[pn] || rbBlMap[pn] || pn;
  }

  // Save parts for each minifig to set_parts_catalog
  for (const [figNum, { parts }] of Object.entries(figPartsMap) as [string, { parts: any[] }][]) {
    for (const p of parts) {
      const blId = finalBlMap[p.part_num] || p.part_num;
      const catKey = `${p.part_num}|${p.color_id}`;
      const existingUrl = existingBlMap[catKey] ? null : null; // image handled separately
      await db.run(
        `INSERT INTO set_parts_catalog
           (set_number, part_number, bl_part_number, color_id, quantity, is_spare)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET
           bl_part_number = $3, quantity = $5, updated_at = NOW()`,
        [figNum, p.part_num, blId, p.color_id||0, p.quantity||1, 0]
      ).catch(() => {});
    }
  }
  
}

// ── Fehlende Bilder neu laden ─────────────────────────────────────────────
// "Fehlend" = image_local ist in der DB gesetzt, die Datei fehlt aber physisch.
// Solche Einträge werden über image_url neu geladen (rate-limited) und das
// Thumbnail neu erzeugt. Schlägt der Download fehl (oder fehlt image_url), wird
// image_local geleert, damit Web + Android auf die CDN-URL zurückfallen.
// Fortschritt liegt für das Monitoring in global_settings (Key imgredl_status).
//
// ── Warum eine prozessübergreifende Sperre ──────────────────────────────────
// Ausgelöst wird der Lauf AUSSCHLIESSLICH aus einem Request-Handler heraus
// (POST /api/v1/admin/redownload-missing-images), also im bearbeitenden
// Cluster-Worker. `_redlRunning` liegt im Speicher eines Prozesses: Zwei Klicks
// auf den Knopf im Monitoring landeten in verschiedenen Workern, und beide
// starteten einen vollständigen Lauf — dieselben Dateien zweimal vom CDN
// geladen (nebenläufig auf denselben Dateinamen geschrieben) und zwei Läufe,
// die im Sekundentakt dasselbe Feld `imgredl_status` überschrieben, sodass die
// Fortschrittsanzeige zwischen zwei Ständen hin und her sprang.
//
// downloadSetImages() hat für genau dieses Problem längst einen Lock (42 je
// Set); dieser Weg lädt aber über downloadFile() direkt und lief ungeschützt.
const { LOCKS } = require('../utils/lockNamespaces');
const REDL_LOCK = LOCKS.BILDER_NACHLAUF;
let _redlRunning = false;

/**
 * Web-Pfad → Dateipfad, für ALLE drei Bildarten (Nachtrag 49).
 *
 * Vorher liess diese Funktion alles ausser `/images/parts/` fallen und gab
 * null zurück. Damit war der Bilder-Nachlauf faktisch auf Teilebilder
 * beschränkt: Set- und Minifiguren-Bilder wurden schon beim Auflösen des
 * Pfades verworfen — noch bevor irgendetwas geprüft werden konnte. Genau
 * deshalb blieb Marcos Set-Bild ohne Vorschau, obwohl der Lauf durchlief und
 * „fertig" meldete.
 */
function _fsPathFromLocal(imageLocal: string) {
  if (!imageLocal) return null;
  const bereiche: Array<[string, string]> = [
    ['/images/parts/',    PART_IMAGES_DIR],
    ['/images/minifigs/', MINIFIG_IMAGES_DIR],
    ['/images/sets/',     SET_IMAGES_DIR],
  ];
  for (const [prefix, dir] of bereiche) {
    if (!imageLocal.startsWith(prefix)) continue;
    const file = imageLocal.slice(prefix.length);
    // Pfadtrenner und .. bleiben verboten — der Wert kommt aus der Datenbank,
    // ist also nicht per se vertrauenswürdig.
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    return path.join(dir, file);
  }
  return null;
}

async function _redlSetStatus(obj: Record<string, unknown>) {
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ('imgredl_status', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1`,
    [JSON.stringify({ ...obj, at: Date.now() })]
  ).catch(() => {});
}

async function redownloadMissingImages() {
  if (_redlRunning) return { alreadyRunning: true };
  // Sperre auf EIGENER Verbindung — Advisory-Locks hängen an der Session,
  // über den Pool würden Sperren und Freigeben auf verschiedenen Verbindungen
  // landen (ausführlich begründet in clients/brickset.ts).
  let lockClient;
  try { lockClient = await db.pool.connect(); }
  catch (e: any) { return { error: e?.message || 'keine Verbindung' }; }
  try {
    const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [REDL_LOCK]);
    if (!rows[0]?.ok) { lockClient.release(); return { alreadyRunning: true }; }
  } catch (e: any) { lockClient.release(); return { error: e?.message || 'Sperre fehlgeschlagen' }; }
  _redlRunning = true;
  try {
    return await _redownloadMissingImages();
  } finally {
    _redlRunning = false;
    await lockClient.query('SELECT pg_advisory_unlock($1, 0)', [REDL_LOCK]).catch(() => {});
    lockClient.release();
  }
}

async function _redownloadMissingImages() {
  const { downloadFile }    = require('../clients/rebrickable');
  const { generateThumb }   = require('../routes/thumbs');
  try {
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    await _redlSetStatus({ running: true, phase: 'scanning', total: 0, done: 0, redownloaded: 0, cleared: 0 });
    // Alle Einträge mit gesetztem image_local (dedupliziert nach Datei).
    const rows = await db.all(
      `SELECT image_local, MAX(image_url) AS image_url FROM (
         SELECT image_local, image_url FROM set_parts_catalog   WHERE image_local IS NOT NULL
         UNION ALL
         SELECT image_local, image_url FROM set_minifigs_catalog WHERE image_local IS NOT NULL
         UNION ALL
         SELECT image_local, image_url FROM parts                WHERE image_local IS NOT NULL
         UNION ALL
         -- sets fehlte hier (Nachtrag 49): Der Lauf liess ausgerechnet die
         -- Set-Bilder aus, die in der Galerie am sichtbarsten sind.
         SELECT image_local, image_url FROM sets                 WHERE image_local IS NOT NULL
       ) t
       GROUP BY image_local`
    ).catch(() => []);
    // Physisch fehlende herausfiltern — UND fehlende Vorschauen einsammeln.
    //
    // Bisher reparierte der Lauf ausschliesslich fehlende DATEIEN. Fehlte nur
    // die Verkleinerung, blieb es dabei: Sie entstand nur beim Erfassen, und
    // ging es dort schief, gab es keinen zweiten Anlauf (Nachtrag 49). Nach dem
    // .tmp-Fehler aus Nachtrag 41 war genau das der Normalzustand — jedes
    // seither erfasste Bild blieb ohne Vorschau.
    const missing: any[] = [];
    const ohneVorschau: string[] = [];
    for (const r of rows) {
      const fp = _fsPathFromLocal(r.image_local);
      if (!fp) continue; // gebündelte /images/ o.ä. überspringen
      const exists = await fs.promises.access(fp).then(() => true).catch(() => false);
      if (!exists) { missing.push({ image_local: r.image_local, image_url: r.image_url, fp }); continue; }
      const thumbFp = fp.replace(/(\.[^.]+)$/, '_thumb.jpg');
      const hatThumb = await fs.promises.access(thumbFp).then(() => true).catch(() => false);
      if (!hatThumb) ohneVorschau.push(r.image_local);
    }

    // Fehlende Vorschauen zuerst: Sie brauchen kein Netz, nur Rechenzeit, und
    // wirken sofort auf jede Kachelwand.
    let thumbsErzeugt = 0;
    if (ohneVorschau.length) {
      await _redlSetStatus({ running: true, phase: 'thumbs', total: ohneVorschau.length, done: 0, redownloaded: 0, cleared: 0 });
      const { generateThumb: _gen } = require('../routes/thumbs');
      for (const web of ohneVorschau) {
        if (await _gen(web).catch(() => null)) thumbsErzeugt++;
      }
      console.log(`[img-redl] ${thumbsErzeugt} fehlende Vorschauen erzeugt (von ${ohneVorschau.length})`);
    }
    const total = missing.length;
    await _redlSetStatus({ running: true, phase: 'downloading', total, done: 0, redownloaded: 0, cleared: 0 });
    if (!total) {
      await _redlSetStatus({ running: false, phase: 'done', total: 0, done: 0, redownloaded: 0, cleared: 0, thumbs: thumbsErzeugt });
      return { total: 0, redownloaded: 0, cleared: 0, thumbs: thumbsErzeugt };
    }

    let done = 0, redownloaded = 0, cleared = 0, _lastFlush = 0;
    const flush = async (force?: boolean) => {
      const now = Date.now();
      if (!force && now - _lastFlush < 1000) return;
      _lastFlush = now;
      await _redlSetStatus({ running: true, phase: 'downloading', total, done, redownloaded, cleared });
    };

    let idx = 0;
    const worker = async () => {
      while (idx < missing.length) {
        const m = missing[idx++];
        let ok = false;
        if (m.image_url) {
          await cdnImageLimiter.acquire().catch(() => {});
          try {
            ok = (await downloadFile(m.image_url, m.fp).catch(() => false)) === true;
          } finally {
            cdnImageLimiter.release();
          }
        }
        if (ok) {
          await generateThumb(m.image_local).catch(() => {});
          redownloaded++;
        } else {
          // Nicht wiederherstellbar -> image_local leeren (Fallback auf CDN-URL)
          for (const tbl of ['set_parts_catalog', 'set_minifigs_catalog', 'parts', 'sets']) {
            await db.run(`UPDATE ${tbl} SET image_local=NULL WHERE image_local=$1`, [m.image_local]).catch(() => {});
          }
          cleared++;
        }
        done++;
        await flush(false);
      }
    };
    const CONC = 2; // wie beim normalen Download; der CDN-Limiter drosselt ohnehin
    await Promise.all(Array.from({ length: CONC }, () => worker()));

    await _redlSetStatus({ running: false, phase: 'done', total, done, redownloaded, cleared, thumbs: thumbsErzeugt });
    console.log(`[img-redl] fertig: ${redownloaded} neu geladen, ${cleared} geleert (von ${total} fehlenden), ${thumbsErzeugt} Vorschauen erzeugt`);
    return { total, redownloaded, cleared, thumbs: thumbsErzeugt };
  } catch (e) {
    await _redlSetStatus({ running: false, phase: 'error', error: fehlertext(e) });
    console.error('[img-redl] Fehler:', fehlertext(e));
    return { error: fehlertext(e) };
  }
}

/** Anzahl laufender Bild-Downloads — für die Monitoring-Ansicht. */
const activeDownloads = () => _downloadLocks.size;

export { enrichSetParts, downloadSetImages, enrichSetMinifigs, downloadImage, redownloadMissingImages, activeDownloads };
