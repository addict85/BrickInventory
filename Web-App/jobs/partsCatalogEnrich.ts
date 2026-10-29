'use strict';
/**
 * Enriches set_parts_catalog from Rebrickable API.
 * Logic:
 * 1. Check if all parts for the set are in set_parts_catalog with image_url
 * 2. If not: call /lego/sets/{set_num}/parts/ API (paginated)
 * 3. Save all parts to set_parts_catalog immediately
 * 4. For each part: if image already local → use it; else return CDN URL and download in background
 */
import { cdnImageLimiter, rebrickableBackgroundLimiter as rebrickableLimiter, consumeRebrickableDaily, parseThrottleWait as ptw } from '../utils/rateLimiter';
import { meldeUndWeiter, fehlertext, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../utils/httpError';
import { neuestesInventar, inventarKandidaten } from '../utils/rbInventar';
import { mitVersion, ohneVersion } from '../utils/setNummer';
import { merkeBlNummer } from '../utils/blZuordnung';
import { merkeTeil, merkeTeilFarbe, merkeSetTeil, setzeTeilBildLokal } from '../utils/katalogPflege';
import { getRbKey, downloadFile } from '../clients/rebrickable';
// Pfade zentral auflösen — __dirname zeigt seit dem dist/-Build nicht mehr
// auf die Wurzel. Siehe utils/appPaths.ts.

/** Ergebnis der handgebauten HTTPS-Aufrufe in dieser Datei. Ohne Typparameter
 *  leitet TypeScript bei `new Promise` `unknown` ab. */
type JobHttpResult = { status: number; body: string };

// Teile- und Figurenbilder liegen seit der Neuordnung getrennt (siehe
// utils/appPaths.ts). downloadImage() bekommt deshalb die Art mitgegeben —
// vorher landete beides im selben Ordner "part_images", was den Namen für die
// Hälfte des Inhalts falsch machte.
import { bildEndung, dateiTeil, zielImOrdner, ladeBild } from '../utils/bildDatei';
import { ERLAUBTE_BILD_HOSTS } from '../utils/fremdeAdressen';
import { setzeZustand } from '../utils/laufzustand';
import * as db from '../db/database';
import https from 'https';
import fs from 'fs';
import path from 'path';
import * as monitor from '../utils/jobMonitor';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } from '../utils/appPaths';
import { LOCKS } from '../utils/lockNamespaces';
import { generateThumb } from '../utils/thumbs';

/** Ohne Browser-Kennung und Referer weist das Rebrickable-CDN Bildabrufe ab. */
const BILD_KOPFZEILEN = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer':    'https://rebrickable.com/',
  'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};


async function apiGet(url: string, rbKey: string) {
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

/**
 * Bild herunterladen und lokal ablegen.
 * Ausführlich: docs/begruendungen/jobs/partsCatalogEnrich.ts.md#abschnitt
 * @param {string} imgUrl
 * @param {string} partNum Teile- oder Figurennummer
 * @param {number} colorId
 * @param {'part'|'minifig'} kind Bestimmt Zielverzeichnis und Web-Pfad.
 */
async function downloadImage(
  imgUrl: string | null | undefined,
  partNum: string,
  colorId: number,
  kind: 'part' | 'minifig',
): Promise<string | null> {
  if (!imgUrl) return null;
  const IMG_DIR = kind === 'minifig' ? MINIFIG_IMAGES_DIR : PART_IMAGES_DIR;
  const webBase = kind === 'minifig' ? '/images/minifigs/' : '/images/parts/';
  // Nummer und Adresse kommen bei manuellen Teilen vom Nutzer: Sie dürfen
  // weder einen Pfad bilden noch die Endung bestimmen (siehe utils/bildDatei.ts).
  const nummer = dateiTeil(partNum), farbe = dateiTeil(colorId);
  if (!nummer || !farbe) return null;
  const file = `${nummer}_${farbe}.${bildEndung(imgUrl)}`;
  const dest = zielImOrdner(IMG_DIR, file);
  if (!dest) return null;
  const rel  = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!await ladeBild(imgUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN)) return null;
  try { await generateThumb(rel).catch(logAndContinue('teile-enrich:generateThumb')); } catch (e) { meldeUndWeiter('teile-enrich:vorschau', e); }
  return rel;
}

async function enrichSetParts(setNumber: string) {
  // n und alt sind dieselben zwei Kandidaten, unter denen auch das Inventar
  // gesucht wird — set_parts_catalog und set_minifigs_catalog fuehren die
  // Nummer in beiden Schreibweisen.
  const [n, alt] = inventarKandidaten(setNumber);

  // Step 1: Check if all CSV parts are already in catalog with image_url
  const invId = await neuestesInventar(setNumber).catch(meldeUndLiefere('teile-enrich:neuestesInventar', null));
  if (!invId) return;

  const csvParts = await db.all(
    `SELECT ip.part_num, ip.color_id, ip.quantity
     FROM rb_inventory_parts ip
     WHERE ip.inventory_id = $1
       AND (ip.is_spare IS NULL OR ip.is_spare IN ('f','false','False','0',''))`,
    [invId]
  );
  if (!csvParts.length) return;

  const catalogRows = await db.all(
    // Ohne bl_part_number: Die Spalte ist mit Migration 0037 weg, und
    // gelesen wurde sie hier nur, um sie gleich wieder zurueckzuschreiben.
    `SELECT part_number, color_id, image_url, image_local
     FROM set_parts_catalog WHERE set_number=$1 OR set_number=$2`,
    [n, alt]
  );
  const catalogMap: any = {};
  for (const r of catalogRows) catalogMap[`${r.part_number}|${r.color_id}`] = r;

  // Alle Teilenummern, zu denen schon eine Zeile in bl_zuordnung steht
  // (= schon ueber die API nachgesehen). Die ZEILE zaehlt, nicht ihr Wert:
  // leer heisst „nachgesehen, keine abweichende Nummer" (Migration 0037).
  const lookedUp = await db.all(
    `SELECT rb_id FROM bl_zuordnung WHERE art = 'part' AND rb_id = ANY($1::text[])`,
    [csvParts.map((p: { part_num: string }) => p.part_num)]
  ).catch(meldeUndLiefere('teile-enrich:lookedUp', []));
  const lookedUpSet = new Set(lookedUp.map((r: { rb_id: string }) => r.rb_id));

  // Only re-enrich parts NOT yet in bl_zuordnung (never looked up)
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
            // Also store in bl_zuordnung for future use
            await merkeBlNummer('part', part.part_num, blId).catch(logAndContinue('teile-enrich:merkeBlNummer'));
          }
        }
      }
    }

    // Build blMap from bl_zuordnung for all csvParts (includes what we just fetched)
    const blMapRows = await db.all(
      `SELECT rb_id, bl_id FROM bl_zuordnung
       WHERE art = 'part' AND rb_id = ANY($1::text[])`,
      [csvParts.map((p: { part_num: string }) => p.part_num)]
    ).catch(meldeUndLiefere('teile-enrich:blMapRows', []));
    const blMap: any = {};
    for (const r of blMapRows) blMap[r.rb_id] = r.bl_id;

    // Step 3: Save all CSV parts to catalog with API data
    for (const p of csvParts) {
      const key  = `${p.part_num}|${p.color_id}`;
      const info = apiParts[key] || {};
      // BL ID: from API response, then from bl_zuordnung (just updated)
      const blPartNum = info.bl_part_num || blMap[p.part_num] || null;
      // Sie geht in die ZUORDNUNG, nicht in den Set-Teile-Katalog
      // (Migration 0037): Sie haengt am Teil, nicht an der Kombination aus
      // Set, Teil und Farbe. Dort stand sie fuer dasselbe Teil so oft, wie
      // es Sets damit gibt.
      if (blPartNum) await merkeBlNummer('part', p.part_num, blPartNum).catch(logAndContinue('teile-enrich:merkeBlNummer'));
      // Ohne Rebrickable-Antwort kein Name — die Teilenummer gehört nicht als geprüfter Name in den Katalog.
      const melde = logAndContinue('katalog:setteil');
      await merkeTeil(p.part_num, info.part_name).catch(melde);
      await merkeTeilFarbe(p.part_num, p.color_id||0, info.color_name, info.color_hex, info.image_url).catch(melde);
      await merkeSetTeil(n, p.part_num, p.color_id||0, p.quantity||1, 0).catch(melde);
      // Refresh catalogMap
      catalogMap[key] = { image_url: info.image_url||null, image_local: null };
    }
  }

  // Fetch minifigs — always refresh from API if catalog is empty
  const existingFigs = await db.get(
    'SELECT COUNT(*) AS c FROM set_minifigs_catalog WHERE set_number=$1 OR set_number=$2',
    [n, alt]
  ).catch(meldeUndLiefere('teile-enrich:existingFigs', null));

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
  const n   = mitVersion(setNumber);
  const alt = ohneVersion(n);

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
    await monitor.imgDlAdd(_pendingAdded).catch(logAndContinue('teile-enrich:imgDlAdd'));

    async function processOne(p: { part_number: string; image_url?: string | null; [k: string]: any }) {
      const rawUrl = p.image_url || '';
      let cdnUrl = rawUrl;
      // Beide Schreibweisen: Zeilen aus der Zeit vor dem Umzug tragen noch
      // /api/img-proxy (siehe utils/images.ts). Ein Muster, das nur die neue
      // kennt, liesse den Altbestand als „ungueltige Adresse" liegen.
      const m = rawUrl.match(/\/api\/(?:v1\/)?img-proxy\?url=(.+)/);
      if (m) cdnUrl = decodeURIComponent((m[1] ?? ''));
      if (!cdnUrl.startsWith('http')) {
        console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
        return;
      }

      const nummer = dateiTeil(p.id), farbe = dateiTeil(p.color_id);
      if (!nummer || (p.kind !== 'fig' && !farbe)) {
        console.warn(`[img-dl] skipping unsafe number ${String(p.id).substring(0, 40)}`);
        return;
      }
      const file = p.kind === 'fig'
        ? `${nummer}.${bildEndung(cdnUrl)}`
        : `${nummer}_${farbe}.${bildEndung(cdnUrl)}`;
      const dest = zielImOrdner(PART_IMAGES_DIR, file);
      if (!dest) return;
      const rel  = `/images/parts/${file}`;

      if (!fs.existsSync(dest)) {
        await cdnImageLimiter.acquire();
        fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
        const ok = await ladeBild(cdnUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN,
          (text) => console.warn(`[img-dl] ${p.id}: ${text}`))
          .finally(() => cdnImageLimiter.release());
        if (!ok) return;
      }

      if (p.kind === 'fig') {
        await db.run(
          `UPDATE set_minifigs_catalog SET image_local=$1
           WHERE (set_number=$2 OR set_number=$3) AND fig_number=$4`,
          [rel, n, alt, p.id]
        ).catch(logAndContinue('teile-enrich:ok'));
      } else {
        await setzeTeilBildLokal(p.id, p.color_id, rel).catch(logAndContinue('katalog:teilbild'));
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
      await monitor.imgDlAdd(-delta).catch(logAndContinue('teile-enrich:imgDlAdd'));
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
    if (_rest > 0) await monitor.imgDlAdd(-_rest).catch(logAndContinue('teile-enrich:imgDlAdd'));
    if (lockClient) {
      if (haveXlock) await lockClient.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCKS.BILD_DOWNLOAD, n]).catch(logAndContinue('teile-enrich:hashtext'));
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

// Enrich all minifigs for a set in one batch
async function enrichSetMinifigs(setNumber: string) {
  const n   = mitVersion(setNumber);
  const alt = ohneVersion(n);
  const rbKey = await getRbKey();
  if (!rbKey) return;

  // Get all minifigs for this set
  const figs = await db.all(
    `SELECT fig_number, quantity FROM set_minifigs_catalog
     WHERE set_number=$1 OR set_number=$2`,
    [n, alt]
  ).catch(meldeUndLiefere('teile-enrich:figs', []));
  if (!figs.length) return;

  // Get all rb_inventories for these minifigs
  const figNums = figs.map((f: { fig_number: string }) => f.fig_number);
  const invRows = await db.all(
    `SELECT set_num, id FROM rb_inventories
     WHERE set_num = ANY($1::text[])
     ORDER BY version DESC`,
    [figNums]
  ).catch(meldeUndLiefere('teile-enrich:invRows', []));

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
    ).catch(meldeUndLiefere('teile-enrich:parts', []));

    figPartsMap[fig.fig_number] = { parts, figQty: fig.quantity };
    parts.forEach((p: { part_num: string }) => allPartNums.add(p.part_num));
  }

  if (!allPartNums.size) return;

  // Die Abfrage auf set_parts_catalog ist WEG
  // Sie las dort `bl_part_number` — eine Abschrift je Set-Teile-Zeile, also
  // fuer dasselbe Teil so oft, wie es Sets damit gibt. Migration 0037 hat die
  // Spalte geloescht; die Abfrage auf bl_zuordnung darunter liest dieselbe …
  // Ausführlich: docs/begruendungen/jobs/partsCatalogEnrich.ts.md#rbblrows

  // bl_zuordnung: die Nummer, einmal je Teil
  const rbBlRows = await db.all(
    `SELECT rb_id, bl_id FROM bl_zuordnung
     WHERE art = 'part' AND rb_id = ANY($1::text[])`,
    [[...allPartNums]]
  ).catch(meldeUndLiefere('teile-enrich:rbBlRows', []));
  const rbBlMap: Record<string, string> = {};
  for (const r of rbBlRows) rbBlMap[r.rb_id] = r.bl_id;

  // Find part_nums NOT yet in bl_zuordnung (= never looked up via API)
  const needsBl = [...allPartNums].filter((pn) => !(String(pn) in rbBlMap));

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
        
        // Persist to bl_zuordnung
        await merkeBlNummer('part', p.part_num, finalId).catch(logAndContinue('teile-enrich:merkeBlNummer'));
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
      // Ohne bl_part_number: Seit Migration 0037 steht die BrickLink-Nummer
      // einmal je Teil in bl_zuordnung, nicht je Set-Teile-Zeile. Die
      // Schleife weiter oben hat sie dort schon gemerkt (merkeBlNummer);
      // finalBlMap wird nur noch fuer die Antwort an den Aufrufer gebraucht.
      await merkeSetTeil(figNum, p.part_num, p.color_id||0, p.quantity||1, 0).catch(logAndContinue('katalog:figurteil'));
    }
  }
  
}

//  Fehlende Bilder neu laden
// "Fehlend" = image_local ist in der DB gesetzt, die Datei fehlt aber physisch.
// Solche Einträge werden über image_url neu geladen (rate-limited) und das
// Thumbnail neu erzeugt. Schlägt der Download fehl (oder fehlt image_url), wird …
// Ausführlich: docs/begruendungen/jobs/partsCatalogEnrich.ts.md#abschnitt-2
const REDL_LOCK = LOCKS.BILDER_NACHLAUF;
let _redlRunning = false;

/**
 * Web-Pfad → Dateipfad, für ALLE drei Bildarten.
 * Ausführlich: docs/begruendungen/jobs/partsCatalogEnrich.ts.md#fspathfromlocal
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

/**
 * Den Fortschritt des Bilder-Nachlaufs ablegen.
 * Ausführlich: docs/begruendungen/jobs/partsCatalogEnrich.ts.md#redlsetstatus
 */
async function _redlSetStatus(obj: Record<string, unknown>) {
  await setzeZustand('imgredl_status', JSON.stringify({ ...obj, at: Date.now() }))
    .catch(logAndContinue('teile-enrich:setzeZustand'));
}

async function redownloadMissingImages() {
  if (_redlRunning) return { alreadyRunning: true };
  // Sperre auf EIGENER Verbindung — Advisory-Locks hängen an der Session,
  // über den Pool würden Sperren und Freigeben auf verschiedenen Verbindungen
  // landen (ausführlich begründet in clients/brickset.ts).
  let lockClient;
  try { lockClient = await db.pool.connect(); }
  catch (e) { return { error: fehlertext(e) || 'keine Verbindung' }; }
  try {
    const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [REDL_LOCK]);
    if (!rows[0]?.ok) { lockClient.release(); return { alreadyRunning: true }; }
  } catch (e) { lockClient.release(); return { error: fehlertext(e) || 'Sperre fehlgeschlagen' }; }
  _redlRunning = true;
  try {
    return await _redownloadMissingImages();
  } finally {
    _redlRunning = false;
    await lockClient.query('SELECT pg_advisory_unlock($1, 0)', [REDL_LOCK]).catch(logAndContinue('teile-enrich:pg_advisory_unlock'));
    lockClient.release();
  }
}

async function _redownloadMissingImages() {
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
         -- Gelesen seit Migration 0034 aus part_color_catalog: Dort steht
         -- jedes Teil-Farb-Paar einmal statt einmal je Konto.
         SELECT image_local, image_url FROM part_color_catalog    WHERE image_local IS NOT NULL
         UNION ALL
         -- Die Figurenbilder fehlten hier ganz: Der Lauf prueft jetzt auch
         -- sie, seit sie mit Migration 0034 einen eigenen Katalog haben.
         SELECT image_local, image_url FROM minifigs_catalog      WHERE image_local IS NOT NULL
         UNION ALL
         -- sets fehlte hier: Der Lauf liess ausgerechnet die
         -- Set-Bilder aus, die in der Galerie am sichtbarsten sind.
         -- Gelesen wird seit Migration 0033 aus set_catalog — dort steht jede
         -- Setnummer einmal statt einmal je Konto.
         SELECT image_local, image_url FROM set_catalog          WHERE image_local IS NOT NULL
       ) t
       GROUP BY image_local`
    ).catch(meldeUndLiefere('teile-enrich:bildpfade lesen', []));
    // Fehlende Dateien UND fehlende Vorschauen einsammeln: Eine Vorschau
    // entsteht sonst nur beim Erfassen und hätte keinen zweiten Anlauf.
    const missing: any[] = [];
    const ohneVorschau: string[] = [];
    for (const r of rows) {
      const fp = _fsPathFromLocal(r.image_local);
      if (!fp) continue; // gebündelte /images/ o.ä. überspringen
      const exists = await fs.promises.access(fp).then(() => true).catch(ohneFehlendeDatei('teile-enrich:access', false));
      if (!exists) { missing.push({ image_local: r.image_local, image_url: r.image_url, fp }); continue; }
      const thumbFp = fp.replace(/(\.[^.]+)$/, '_thumb.jpg');
      const hatThumb = await fs.promises.access(thumbFp).then(() => true).catch(ohneFehlendeDatei('teile-enrich:access', false));
      if (!hatThumb) ohneVorschau.push(r.image_local);
    }

    // Fehlende Vorschauen zuerst: Sie brauchen kein Netz, nur Rechenzeit, und
    // wirken sofort auf jede Kachelwand.
    let thumbsErzeugt = 0;
    if (ohneVorschau.length) {
      await _redlSetStatus({ running: true, phase: 'thumbs', total: ohneVorschau.length, done: 0, redownloaded: 0, cleared: 0 });
      for (const web of ohneVorschau) {
        if (await generateThumb(web).catch(meldeUndLiefere('teile-enrich:vorschau', null))) thumbsErzeugt++;
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
          await cdnImageLimiter.acquire().catch(logAndContinue('teile-enrich:acquire'));
          try {
            ok = (await downloadFile(m.image_url, m.fp).catch(meldeUndLiefere('teile-enrich:downloadFile', false))) === true;
          } finally {
            cdnImageLimiter.release();
          }
        }
        if (ok) {
          await generateThumb(m.image_local).catch(logAndContinue('teile-enrich:generateThumb'));
          redownloaded++;
        } else {
          // Nicht wiederherstellbar -> image_local leeren
          // Damit fallen beide Oberflaechen auf die CDN-URL zurueck. Die
          // Liste MUSS zu den Tabellen passen, die die Spalte wirklich haben,
          // und das tat sie nicht mehr:
          // Ausführlich: docs/begruendungen/jobs/partsCatalogEnrich.ts.md#redownloadmissingimages
          for (const tbl of ['set_parts_catalog', 'set_minifigs_catalog',
                             'part_color_catalog', 'minifigs_catalog', 'set_catalog']) {
            await db.run(`UPDATE ${tbl} SET image_local=NULL WHERE image_local=$1`, [m.image_local])
              .catch(logAndContinue(`img-redl:leeren ${tbl}`));
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

export { enrichSetParts, downloadSetImages, enrichSetMinifigs, downloadImage, redownloadMissingImages };
