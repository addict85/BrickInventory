// ── Warum diese Datei nicht mehr in routes/ liegt (Nachtrag 126) ────────────
//
// Sie enthält KEINE einzige Route und wird nirgends als Router montiert — sie
// ist ein reiner API-Client. In routes/ zu liegen war ein Erbstück, hatte aber
// Folgen: Wer sie importierte, importierte scheinbar einen Router, und die
// Kreise, die daraus entstanden, wurden mit späten `require()` umgangen.
//
import { rebrickableLimiter, consumeRebrickableDaily, rebrickableDailyStatus, parseThrottleWait } from '../utils/rateLimiter';
import { istErsatzteil } from '../utils/validate';

import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs';
import * as db from '../db/database';
import { rebrickableBackgroundLimiter } from '../utils/rateLimiter';
import { fehlertext } from '../utils/httpError';

const BASE = 'https://rebrickable.com/api/v3';


/**
 * Eine Teilezeile, wie sie /lego/sets/{id}/parts liefert.
 *
 * Steht HIER und nicht bei den zwei Aufrufern: Der Vertrag gehoert dem, der
 * ihn liefert. Zweimal hingeschrieben waere er eine zweite Wahrheit, die beim
 * naechsten Feld auseinanderlaeuft.
 *
 * Alles Optionale ist als solches markiert; jedes `||`- oder `??`-Ausweichen
 * bei den Aufrufern entspricht genau einem `?` hier.
 */
export type RbSetTeil = {
  part: {
    part_num: string;
    name?: string | null;
    part_img_url?: string | null;
    external_ids?: { BrickLink?: string[] };
  };
  color: { id: number; name?: string | null; rgb?: string | null };
  quantity: number;
  is_spare?: boolean;
};

async function getRbKey() {
  return (await db.get("SELECT value FROM global_settings WHERE key='rebrickable_api_key'"))?.value || '';
}

function httpsGetRobust(url: string, headers: Record<string, string> = {}, timeoutMs = 60000): Promise<{ status: number; body: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = (u: string) => {
      attempts++;
      let parsed; try { parsed = new URL(u); } catch (e) { return reject(new Error('Invalid URL: ' + u)); }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers } }, res => {
        req.setTimeout(0);
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          const ziel = res.headers.location;
          // Eine Umleitung OHNE Location-Kopfzeile ist nicht befolgbar. Vorher
          // lief `undefined` in attempt(), und das kam als
          // "Invalid URL: undefined" heraus — richtig abgewiesen, aber mit
          // einer Meldung, die auf die falsche Ursache zeigt. Der Typ
          // (string | undefined) hat die Stelle sichtbar gemacht.
          if (!ziel) return reject(new Error(
            `Umleitung ${res.statusCode} ohne Location-Kopfzeile: ${u.substring(0, 120)}`));
          return attempt(ziel);
        }
        if (res.statusCode === 429) {
          let body429 = '';
          res.on('data', d => body429 += d);
          res.on('end', () => {
            const wait = parseThrottleWait(body429);
            console.log(`[rebrickable] 429 throttled, waiting ${wait}ms...`);
            rebrickableLimiter.throttle(wait);
            if (attempts < 3) return setTimeout(() => attempt(u), wait);
            resolve({ status:429, body:'', buffer:Buffer.alloc(0) });
          });
          return;
        }
        if (res.statusCode === 403) { res.resume(); return resolve({ status:403, body:'', buffer:Buffer.alloc(0) }); }
        const chunks: any[] = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => { const buffer = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, body: buffer.toString('utf-8'), buffer }); });
        res.on('error', err => { if (attempts < 3) setTimeout(() => attempt(u), 1000); else reject(err); });
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); if (attempts < 2) { setTimeout(() => attempt(u), 1000); } else reject(new Error(`Timeout: ${u.substring(0,120)}`)); });
      req.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'ECONNRESET' && attempts < 3) setTimeout(() => attempt(u), 1500); else reject(err); });
    };
    attempt(url);
  });
}

async function rbGet(apiPath: string, params: Record<string, string | number> = {}) {
  const key = await getRbKey();
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  await rebrickableLimiter.waitForSlot();
  // Daily cap: 100/day
  if (!await consumeRebrickableDaily()) {
    // Zahl aus dem gemeinsamen Zähler statt hartkodiert — der Text sagte
    // "100/Tag", während das tatsächliche Limit längst bei 4000 lag.
    const { limit } = await rebrickableDailyStatus();
    throw new Error(`Rebrickable Tageslimit erreicht (${limit}/Tag). Versuche es morgen wieder.`);
  }
  const qs = new URLSearchParams({ page_size: '500', ...params }).toString();
  const { status, body } = await httpsGetRobust(`${BASE}${apiPath}?${qs}`, { Authorization: `key ${key}` }, 45000);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Rebrickable ${status}: ${body.substring(0, 150)}`);
  return JSON.parse(body);
}

const themeCache = new Map();
async function getThemeName(themeId: number | string) {
  if (!themeId) return null;
  if (themeCache.has(themeId)) return themeCache.get(themeId);
  try { const d = await rbGet(`/lego/themes/${themeId}/`); const name = d?.name||null; themeCache.set(themeId, name); return name; }
  catch (_) { return null; }
}

async function getSetInfo(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const cached = await db.get('SELECT * FROM catalog_cache WHERE set_number = $1', [n]);
  if (cached?.name) return cached;
  const data = await rbGet(`/lego/sets/${n}/`);
  if (!data) {
    const hasKey = !!(await getRbKey());
    await db.run('INSERT INTO catalog_cache (set_number, name, is_gear) VALUES ($1,$2,$3) ON CONFLICT (set_number) DO UPDATE SET is_gear=$3',
      [n, `Set ${n}`, hasKey ? 1 : 0]);
    return null;
  }
  const theme = await getThemeName(data.theme_id);
  const row = { set_number:n, name:data.name||null, year:data.year||null, theme:theme||null, pieces:data.num_parts||null, image_url:data.set_img_url||null, is_gear:0 };
  await db.run('INSERT INTO catalog_cache (set_number,name,year,theme,pieces,image_url,is_gear) VALUES ($1,$2,$3,$4,$5,$6,0) ON CONFLICT (set_number) DO UPDATE SET name=$2,year=$3,theme=$4,pieces=$5,image_url=$6,is_gear=0',
    [n, row.name, row.year, row.theme, row.pieces, row.image_url]);
  return row;
}

async function getAllSetPartsFromCsv(setNumber: string) {
  const db = require('../db/database');
  const n = setNumber.includes('-') ? setNumber : setNumber + '-1';
  const bare = n.replace(/-\d+$/, ''); // e.g. "42083" from "42083-1"
  const inv = await db.get(
    `SELECT id FROM rb_inventories WHERE set_num=$1 OR set_num=$2 ORDER BY version DESC LIMIT 1`,
    [n, bare]
  ).catch(()=>null);
  if (!inv) return null;

  const parts = await db.all(
    `SELECT ip.part_num, ip.color_id, ip.quantity, ip.is_spare, ip.img_url,
            p.name, p.part_img_url,
            c.name as color_name, c.rgb as color_rgb,
            m.bl_part_num
     FROM rb_inventory_parts ip
     LEFT JOIN rb_parts p ON p.part_num = ip.part_num
     LEFT JOIN rb_colors c ON c.id = ip.color_id
     LEFT JOIN rb_bl_mapping m ON m.part_num = ip.part_num
     WHERE ip.inventory_id = $1`,
    [inv.id]
  ).catch(()=>[]);

  if (!parts.length) return null;
  return parts.map((p: any) => ({
    part: {
      part_num:     p.part_num,
      name:         p.name || p.part_num,
      part_img_url: p.part_img_url || p.img_url || null,
      external_ids: { BrickLink: p.bl_part_num && p.bl_part_num !== p.part_num ? [p.bl_part_num] : [] }
    },
    color: {
      id:   p.color_id,
      name: p.color_name || '',
      rgb:  p.color_rgb || null
    },
    quantity:  p.quantity,
    // Vorher eine eigene Aufzaehlung — die 'true' KLEINGESCHRIEBEN nicht
    // kannte, waehrend die Teileliste daneben es tat.
    is_spare:  istErsatzteil(p.is_spare)
  }));
}

async function getAllSetParts(setNumber: string) {
  // Try local CSV data first (fast, no API quota used)
  const csvParts = await getAllSetPartsFromCsv(setNumber);
  if (csvParts) {
    return csvParts;
  }
  return getAllSetPartsApi(setNumber);
}

async function getAllSetPartsApi(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const cached = await db.get('SELECT data FROM subsets_cache WHERE set_number = $1', [n]);
  if (cached) { try { return JSON.parse(cached.data); } catch (_) {} }
  const key = await getRbKey();
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  const allParts: any[] = [];
  let url = `${BASE}/lego/sets/${n}/parts/?page_size=500&inc_part_details=1`;
  let pages = 0;
  while (url && pages++ < 40) {
    if (!await consumeRebrickableDaily()) {
      console.error(`[rebrickable] Tageslimit (${(await rebrickableDailyStatus()).limit}/Tag) erreicht — ${n} übersprungen`);
      break;
    }
    await rebrickableLimiter.waitForSlot();
    let status, body;
    try { ({ status, body } = await httpsGetRobust(url, { Authorization: `key ${key}` }, 60000)); }
    catch (e) { console.error(`  Parts page ${pages} failed: ${fehlertext(e)}`); break; }
    if (status === 404 || status === 403) {
      if (status === 403) {
        console.log(`  Parts HTTP 403 for ${n} — set not found or access denied, skipping`);
        // Cache empty result so we don't retry on every reimport
        await db.run('INSERT INTO subsets_cache (set_number, data) VALUES ($1,$2) ON CONFLICT (set_number) DO UPDATE SET data=$2, fetched_at=NOW()',
          [n, '[]']);
      }
      break;
    }
    if (status !== 200) { console.error(`  Parts HTTP ${status}`); break; }
    let data; try { data = JSON.parse(body); } catch (e) { break; }
    allParts.push(...(data.results || []));
    url = data.next || null;
    if (url) await sleep(500);
  }
  if (allParts.length > 0) {
    await db.run('INSERT INTO subsets_cache (set_number, data) VALUES ($1,$2) ON CONFLICT (set_number) DO UPDATE SET data=$2, fetched_at=NOW()',
      [n, JSON.stringify(allParts)]);
  }
  return allParts;
}

async function scrapeInstructions(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  try {
    const { status, body } = await httpsGetRobust(`https://rebrickable.com/sets/${n}/`, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }, 8000);
    if (status !== 200) return [];
    const found: any[] = [];
    for (const re of [/href="(https?:\/\/[^"]*lego\.com[^"]*\.pdf[^"]*)"/gi, /href="(https?:\/\/cdn\.rebrickable\.com\/media\/instructions[^"]+\.pdf[^"]*)"/gi, /href="(https?:\/\/assets\.lego\.com[^"]*\.pdf[^"]*)"/gi]) {
      // Der Typ muss hier stehen: Ohne ihn ist `let m` implizit any und der
      // Zugriff m[1] unten ungeprueft (TS7034/TS7005).
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        // Der Treffer wird in eine Konstante gezogen: Innerhalb des
        // find()-Rueckrufs kann der Uebersetzer `m` nicht mehr als
        // nicht-null fuehren — ein Rueckruf koennte grundsaetzlich spaeter
        // laufen, wenn m schon weitergerueckt ist.
        const treffer = m[1];
        if (!found.find(f => f.url === treffer)) found.push({ url: treffer, description: `Anleitung ${n}` });
      }
    }
    return found;
  } catch (_) { return []; }
}

async function downloadFile(url: string, destPath: string) {
  if (fs.existsSync(destPath)) return true;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  return new Promise(resolve => {
    const attempt = (u: string, redirects = 0) => {
      if (redirects > 5) return resolve(false);
      let parsed; try { parsed = new URL(u); } catch (_) { return resolve(false); }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(u, { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer':    'https://rebrickable.com/',
        'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      } }, res => {
        if ((res.statusCode===301||res.statusCode===302) && res.headers.location) {
          res.resume();
          return attempt(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(false); }
        // Stream directly to file — avoids buffering large PDFs in memory
        const out = fs.createWriteStream(destPath);
        let size = 0;
        res.on('data', chunk => { size += chunk.length; });
        res.pipe(out);
        out.on('finish', () => {
          if (size < 100) { fs.unlink(destPath, () => {}); return resolve(false); }
          resolve(true);
        });
        out.on('error', () => { fs.unlink(destPath, () => {}); resolve(false); });
        res.on('error',  () => { fs.unlink(destPath, () => {}); resolve(false); });
      });
      req.setTimeout(60000, () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    };
    attempt(url);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }


// ── Minifigs in a set ─────────────────────────────────────────────────────────
async function getSetMinifigs(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  try {
    const key = await getRbKey();
    if (!key) return [];
    // Use background limiter — this is called from background jobs
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/sets/${n}/minifigs/?page_size=100`,
      { Authorization: `key ${key}` }, 30000
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    if (!data?.results) return [];
    return data.results.map((m: { id: number; set_num?: string; quantity?: number;
                                 set_name?: string; set_img_url?: string | null }) => ({
      fig_number: m.set_num,
      fig_name:   m.set_name,
      quantity:   m.quantity || 1,
      image_url:  m.set_img_url || null,
    }));
  } catch (e) {
    console.log(`  Minifigs fetch failed for ${n}: ${fehlertext(e)}`);
    return [];
  }
}

// ── Single minifig lookup ─────────────────────────────────────────────────────
async function getMinifigInfo(figNumber: string) {
  try {
    const data = await rbGet(`/lego/minifigs/${figNumber}/`);
    if (!data) return null;
    return {
      fig_number: data.set_num || figNumber,
      fig_name:   data.name || null,
      image_url:  data.set_img_url || null,
    };
  } catch (_) { return null; }
}

// ── Get color list ──────────────────────────────────────────────────────
let _colorsCache: any = null;
async function getBrickColors() {
  if (_colorsCache) return _colorsCache;
  try {
    const key = await getRbKey();
    if (!key) return [];
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/colors/?page_size=500`,
      { Authorization: `key ${key}` }, 15000
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    _colorsCache = (data.results || []).map((c: { id: number; name?: string;
                                                 rgb?: string | null }) => ({
      id:   c.id,
      name: c.name,
      hex:  c.rgb || null,
    }));
    return _colorsCache;
  } catch (_) { return []; }
}

// ── Get the parts that make up a minifig (used to estimate a market price via
// its constituent parts when no direct BrickLink minifig number is known) ────
// Global, shared cache (analog subsets_cache for sets) since this data rarely
// changes and Rebrickable's API is rate-limited.
async function getMinifigParts(figNumber: string) {
  const cached = await db.get('SELECT data FROM minifig_parts_cache WHERE fig_number = $1', [figNumber]).catch(() => null);
  if (cached) { try { return JSON.parse(cached.data); } catch (_) {} }

  const key = await getRbKey();
  if (!key) return [];
  if (!await consumeRebrickableDaily()) {
    console.error(`[rebrickable] Tageslimit (${(await rebrickableDailyStatus()).limit}/Tag) erreicht — Minifig-Teile für ${figNumber} übersprungen`);
    return [];
  }
  try {
    await rebrickableLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/minifigs/${encodeURIComponent(figNumber)}/parts/?page_size=200&inc_part_details=1`,
      { Authorization: `key ${key}` }, 30000
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    const parts = (data.results || []).map((r: RbSetTeil) => ({
      part_num:  r.part?.part_num || null,
      color_id:  r.color?.id ?? 0,
      quantity:  r.quantity || 1,
      bl_part_num: r.part?.external_ids?.BrickLink?.[0] || null,
    })).filter((p: { part_num?: string | null }) => p.part_num);

    await db.run(
      'INSERT INTO minifig_parts_cache (fig_number, data, fetched_at) VALUES ($1,$2,NOW()) ON CONFLICT (fig_number) DO UPDATE SET data=$2, fetched_at=NOW()',
      [figNumber, JSON.stringify(parts)]
    ).catch(() => {});

    return parts;
  } catch (_) { return []; }
}

export { getSetInfo, getAllSetParts, downloadFile, scrapeInstructions,
  getSetMinifigs, getMinifigInfo, getBrickColors, getRbKey, sleep, httpsGetRobust, getMinifigParts };
