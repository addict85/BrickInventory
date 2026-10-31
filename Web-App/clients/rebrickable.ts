// ── Warum diese Datei nicht mehr in routes/ liegt ────────────
//
// Sie enthält KEINE einzige Route und wird nirgends als Router montiert — sie
// ist ein reiner API-Client. In routes/ zu liegen war ein Erbstück, hatte aber
// Folgen: Wer sie importierte, importierte scheinbar einen Router, und die
// Kreise, die daraus entstanden, wurden mit späten `require()` umgangen.
//
import { rebrickableLimiter, consumeRebrickableDaily, rebrickableDailyStatus, parseThrottleWait } from '../utils/rateLimiter';
import { istErsatzteil, KEINE_FARBE } from '../src/infra/validate';

import https from 'https';
import path from 'path';
import fs from 'fs';
import * as db from '../db/database';
import { rebrickableBackgroundLimiter } from '../utils/rateLimiter';
import { fehlertext, meldeUndLiefere } from '../src/infra/httpError';
import { neuestesInventar } from '../utils/rbInventar';
import { mitVersion } from '../utils/setNummer';
import { getGlobalSetting } from '../utils/settings';
import { ERLAUBTE_DOWNLOAD_HOSTS, hostErlaubt, naechsteUmleitung,
         UMLEITUNGS_GRENZE, pfadSegment } from '../src/infra/fremdeAdressen';

const BASE = 'https://rebrickable.com/api/v3';


/**
 * Eine Teilezeile, wie sie /lego/sets/{id}/parts liefert.
 * Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#rbsetteil
 */
export type RbSetTeil = {
  part: {
    part_num: string;
    name?: string | null;
    part_img_url?: string | null;
    part_cat_id?: number | null;
    external_ids?: { BrickLink?: string[] };
  };
  color: { id: number; name?: string | null; rgb?: string | null };
  quantity: number;
  is_spare?: boolean;
};

/**
 * Der Rebrickable-Schluessel — aus der zentralen Einstellungs-Lesung.
 * Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#getrbkey
 */
async function getRbKey(): Promise<string | null> {
  return await getGlobalSetting('rebrickable_api_key') || null;
}

/**
 * Ein GET gegen die Rebrickable-API mit Tageskontingent und Drossel. Jeder
 * Fehlschlag (kein Schlüssel, Kontingent, Netz, Status) ist null: Die Aufrufer
 * suchen dann auf dem nächsten Weg weiter.
 */
async function rebrickableJson(pfad: string): Promise<any> {
  const key = await getRbKey();
  if (!key) return null;
  if (!await consumeRebrickableDaily()) {
    console.log(`[rebrickable] Tageslimit erreicht — ${pfad} übersprungen`);
    return null;
  }
  await rebrickableLimiter.waitForSlot();
  const r = await httpsGetRobust(`${BASE}${pfad}`, { Authorization: `key ${key}` }, 8000)
    .catch(meldeUndLiefere(`rebrickable:${pfad}`, null));
  if (!r || r.status !== 200) return null;
  try { return JSON.parse(r.body); } catch (e) { return meldeUndLiefere(`rebrickable:${pfad}`, null)(e); }
}

function httpsGetRobust(url: string, headers: Record<string, string> = {}, timeoutMs = 60000): Promise<{ status: number; body: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    // Umleitungen zaehlen EIGENS, nicht ueber `attempts`.
    //
    // `attempts` zaehlt jeden Anlauf mit und wird nur bei 429, Timeout und
    // ECONNRESET geprueft — beim Umleiten sah es niemand an. Eine Schleife
    // A -> B -> A lief damit unbegrenzt weiter, und ausloesen konnte das der
    // fremde Server ganz allein.
    let umleitungen = 0;
    const attempt = (u: string, kopf: Record<string, string>) => {
      attempts++;
      let parsed; try { parsed = new URL(u); } catch (e) { return reject(new Error('Invalid URL: ' + u)); }
      if (parsed.protocol !== 'https:') return reject(new Error('Nur https: ' + u));
      const req = https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...kopf } }, res => {
        req.setTimeout(0);
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          // Neun der zwoelf Aufrufer dieser Funktion schicken
          // `Authorization: key <REBRICKABLE_API_KEY>`. Bis hierher wurde der
          // Kopf beim Folgen unveraendert weitergereicht — eine Umleitung auf
          // einen fremden Host bekam damit den Schluessel, und eine Umleitung …
          // Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#httpsgetrobust
          if (++umleitungen > UMLEITUNGS_GRENZE) return reject(new Error(
            `Mehr als ${UMLEITUNGS_GRENZE} Umleitungen: ${u.substring(0, 120)}`));
          const weiter = naechsteUmleitung(u, res.headers.location, kopf);
          // Eine Umleitung ohne Location-Kopfzeile, auf http oder auf ein
          // anderes Schema ist nicht befolgbar. Vorher lief `undefined` in
          // attempt() und kam als "Invalid URL: undefined" heraus — richtig
          // abgewiesen, aber mit einer Meldung, die auf die falsche Ursache
          // zeigt.
          if (!weiter) return reject(new Error(
            `Umleitung ${res.statusCode} nicht befolgbar (fehlend, kein https, oder unlesbar): ${u.substring(0, 120)}`));
          return attempt(weiter.url, weiter.kopfzeilen);
        }
        if (res.statusCode === 429) {
          let body429 = '';
          res.on('data', d => body429 += d);
          res.on('end', () => {
            const wait = parseThrottleWait(body429);
            console.log(`[rebrickable] 429 throttled, waiting ${wait}ms...`);
            rebrickableLimiter.throttle(wait);
            if (attempts < 3) return setTimeout(() => attempt(u, kopf), wait);
            resolve({ status:429, body:'', buffer:Buffer.alloc(0) });
          });
          return;
        }
        if (res.statusCode === 403) { res.resume(); return resolve({ status:403, body:'', buffer:Buffer.alloc(0) }); }
        const chunks: any[] = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => { const buffer = Buffer.concat(chunks); resolve({ status: res.statusCode ?? 0, body: buffer.toString('utf-8'), buffer }); });
        res.on('error', err => { if (attempts < 3) setTimeout(() => attempt(u, kopf), 1000); else reject(err); });
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); if (attempts < 2) { setTimeout(() => attempt(u, kopf), 1000); } else reject(new Error(`Timeout: ${u.substring(0,120)}`)); });
      req.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'ECONNRESET' && attempts < 3) setTimeout(() => attempt(u, kopf), 1500); else reject(err); });
    };
    attempt(url, headers);
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
  try { const d = await rbGet(`/lego/themes/${pfadSegment(themeId)}/`); const name = d?.name||null; themeCache.set(themeId, name); return name; }
  catch (_) { return null; }
}

async function getSetInfo(setNumber: string) {
  const n = mitVersion(setNumber);
  const cached = await db.get('SELECT * FROM catalog_cache WHERE set_number = $1', [n]);
  // "Set <Nummer>" ist ein Platzhalter (BrickLink-Typprüfung, Rebrickable-404)
  // und kein Name. Als Treffer zurückgegeben, überschrieb er beim nächsten
  // Erfassen den echten Namen im Katalog. Nachgefragt wird höchstens täglich.
  if (cached?.name && cached.name !== `Set ${n}`) return cached;
  if (cached?.name && cached.fetched_at && Date.now() - new Date(cached.fetched_at).getTime() < 86_400_000) return null;
  const data = await rbGet(`/lego/sets/${pfadSegment(n)}/`);
  if (!data) {
    const hasKey = !!(await getRbKey());
    await db.run('INSERT INTO catalog_cache (set_number, name, is_gear) VALUES ($1,$2,$3) ON CONFLICT (set_number) DO UPDATE SET is_gear=$3, fetched_at=NOW()',
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
  const invId = await neuestesInventar(setNumber).catch(() => null);
  if (!invId) return null;

  const parts = await db.all(
    `SELECT ip.part_num, ip.color_id, ip.quantity, ip.is_spare, ip.img_url,
            p.name, p.part_img_url,
            c.name as color_name, c.rgb as color_rgb,
            m.bl_id AS bl_part_num
     FROM rb_inventory_parts ip
     LEFT JOIN rb_parts p ON p.part_num = ip.part_num
     LEFT JOIN rb_colors c ON c.id = ip.color_id
     LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
     WHERE ip.inventory_id = $1`,
    [invId]
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
  const n = mitVersion(setNumber);
  const cached = await db.get('SELECT data FROM subsets_cache WHERE set_number = $1', [n]);
  if (cached) { try { return JSON.parse(cached.data); } catch (_) {} }
  const key = await getRbKey();
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  const allParts: any[] = [];
  let url = `${BASE}/lego/sets/${pfadSegment(n)}/parts/?page_size=500&inc_part_details=1`;
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
  const n = mitVersion(setNumber);
  try {
    const { status, body } = await httpsGetRobust(`https://rebrickable.com/sets/${pfadSegment(n)}/`, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }, 8000);
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

/**
 * Obergrenze je Datei. Eine Bauanleitung hat selten über 150 MB; ohne Grenze
 * füllte ein Server, der endlos sendet, die Platte. Abgebrochen wird im Strom.
 */
export const DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024;

async function downloadFile(url: string, destPath: string, maxBytes = DOWNLOAD_MAX_BYTES) {
  if (fs.existsSync(destPath)) return true;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  // Warum der Host hier geprueft wird, und zwar bei JEDEM Sprung
  // Was diese Funktion holt, landet unter data/instructions/ bzw. im
  // Bild-Cache — und von dort liefert der Server es an jeden angemeldeten
  // Nutzer aus. Ein ungeprueftes Umleitungsziel wie http://127.0.0.1:5432/ …
  // Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#downloadfile
  // Nur https: Im Klartext könnte jeder auf dem Weg die Datei austauschen.
  if (!url.startsWith('https://') || !hostErlaubt(url, ERLAUBTE_DOWNLOAD_HOSTS)) {
    console.warn(`[download] Adresse nicht in der Liste erlaubter Hosts: ${url.substring(0, 120)}`);
    return false;
  }
  return new Promise(resolve => {
    const kopfBasis: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer':    'https://rebrickable.com/',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    const attempt = (u: string, kopf: Record<string, string>, redirects = 0) => {
      if (redirects > UMLEITUNGS_GRENZE) return resolve(false);
      let parsed; try { parsed = new URL(u); } catch (_) { return resolve(false); }
      if (parsed.protocol !== 'https:') return resolve(false);
      const req = https.get(u, { family: 4, headers: kopf }, res => {
        if (res.statusCode===301||res.statusCode===302) {
          res.resume();
          // Dieselbe Regel wie in httpsGetRobust — hier zusaetzlich mit der
          // Host-Liste, aus dem Grund im Block ueber dieser Funktion.
          const weiter = naechsteUmleitung(u, res.headers.location, kopf, ERLAUBTE_DOWNLOAD_HOSTS);
          if (!weiter) return resolve(false);
          return attempt(weiter.url, weiter.kopfzeilen, redirects + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(false); }
        if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); return resolve(false); }
        // Stream directly to file — avoids buffering large PDFs in memory
        const out = fs.createWriteStream(destPath);
        let size = 0, zuGross = false;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes && !zuGross) {
            zuGross = true;
            console.warn(`[download] Abgebrochen nach ${maxBytes} Byte: ${u.substring(0, 120)}`);
            res.unpipe(out); res.destroy(); out.destroy();
            fs.unlink(destPath, () => {}); resolve(false);
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          if (zuGross) return;
          if (size < 100) { fs.unlink(destPath, () => {}); return resolve(false); }
          resolve(true);
        });
        out.on('error', () => { fs.unlink(destPath, () => {}); resolve(false); });
        res.on('error',  () => { fs.unlink(destPath, () => {}); resolve(false); });
      });
      req.setTimeout(60000, () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    };
    attempt(url, kopfBasis);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }


// ── Minifigs in a set ─────────────────────────────────────────────────────────
async function getSetMinifigs(setNumber: string) {
  const n = mitVersion(setNumber);
  try {
    const key = await getRbKey();
    if (!key) return [];
    // Use background limiter — this is called from background jobs
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/sets/${pfadSegment(n)}/minifigs/?page_size=100`,
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
    const data = await rbGet(`/lego/minifigs/${pfadSegment(figNumber)}/`);
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
      `${BASE}/lego/minifigs/${pfadSegment(figNumber)}/parts/?page_size=200&inc_part_details=1`,
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


/**
 * ── Warum lookupPart hier steht und nicht mehr in routes/parts.ts ───────────
 * Es ist eine reine Rebrickable-Abfrage: getRbKey(), httpsGetRobust() und die
 * Hintergrunddrossel — alles aus dieser Datei bzw. utils/rateLimiter, nichts
 * aus der Route. Es lag dort, weil die HTTP-Route dort steht, die es ausloest;
 * gebraucht wurde es aber auch von jobs/purchasePriceBackfill.ts, und der
 * musste dafuer aus einer ROUTE importieren.
 */
async function lookupPart(partNumber: string, colorId?: number | null) {
  const key = await getRbKey();
  if (!key) return null;
  try {
    // Use batch endpoint ?part_nums= instead of single /parts/{num}/
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${encodeURIComponent(partNumber)}&page_size=1`,
      { Authorization: `key ${key}` }, 15000
    );
    if (status !== 200) return null;
    const d = JSON.parse(body);
    const part = d.results?.[0];
    if (!part) return null;
    let image_url = part.part_img_url || null;

    // Bild soll den Stein immer in der gewählten Farbe zeigen: Rebrickable
    // liefert dafür ein eigenes Farb-Bild über den Parts/Colors-Endpoint.
    // (Der lokale set_parts_catalog-Cache ist meist leer, da er nur Farben
    // enthält, die bereits über ein importiertes Set gesehen wurden.) …
    // Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#lookuppart
    if (colorId !== null && colorId !== undefined && colorId !== KEINE_FARBE) {
      try {
        await rebrickableBackgroundLimiter.waitForSlot();
        const colorResp = await httpsGetRobust(
          `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNumber)}/colors/${colorId}/`,
          { Authorization: `key ${key}` }, 15000
        );
        if (colorResp.status === 200) {
          const cd = JSON.parse(colorResp.body);
          if (cd?.part_img_url) image_url = cd.part_img_url;
        }
      } catch (_) { /* fall back to generic part image */ }
    }

    return {
      part_name:     part.name || null,
      category_name: part.part_cat_id ? String(part.part_cat_id) : null,
      image_url,
    };
  } catch (_) { return null; }
}


// BrickLink-Nummer → Rebrickable-Nummer
// Fuer den Import von BrickLink-Wanted-Listen. Die
// Richtung ist die UNGEWOHNTE: Der ganze uebrige Baum geht von Rebrickable
// nach BrickLink (external_ids), weil Rebrickable die Heimatnummer fuehrt.
// Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#abschnitt

/**
 * Traegt dieses Rebrickable-Teil die gesuchte BrickLink-Nummer?
 * Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#traegtblnummer
 */
function traegtBlNummer(teil: unknown, blId: string): boolean {
  const ext = (teil as { external_ids?: Record<string, unknown> } | null)?.external_ids;
  const roh = ext?.['BrickLink'];
  const liste: unknown[] = Array.isArray(roh) ? roh
    : Array.isArray((roh as { ext_ids?: unknown[] } | undefined)?.ext_ids)
      ? (roh as { ext_ids: unknown[] }).ext_ids : [];
  return liste.some(x => String(x).toLowerCase() === blId.toLowerCase());
}

/**
 * Wurde der Filter schon einmal als wirkungslos erkannt?
 *
 * Modulweit und nicht je Aufruf: Die Antwort gilt fuer den Dienst, nicht fuer
 * die Nummer. Zuruecksetzen braucht es nicht — ein Neustart tut es, und bis
 * dahin waere jeder weitere Versuch dieselbe verbrannte Abfrage.
 */
let filterWirkungslos = false;

/**
 * Eine BrickLink-Teilenummer auf eine Rebrickable-Nummer abbilden.
 *
 * @returns die Rebrickable-Nummer, oder null wenn sich keine BELEGEN liess.
 */
async function blTeilZuRb(blId: string): Promise<string | null> {
  // ── Weg 1: die Nummer auf sich selbst pruefen ────────────────────────────
  //
  // Bei den meisten Teilen benutzen beide Dienste dieselbe Nummer. Dann
  // liefert /lego/parts/{nr}/ den Treffer, und external_ids bestaetigt ihn —
  // aus einer VERMUTUNG („die Nummern sind wohl gleich") wird eine Abbildung.
  const direkt = await rbGet(`/lego/parts/${pfadSegment(blId)}/`).catch(() => null);
  if (direkt && traegtBlNummer(direkt, blId)) return String(direkt.part_num);

  // ── Weg 2: der Filter, mit Gegenpruefung ────────────────────────────────
  if (filterWirkungslos) return null;
  const gefiltert = await rbGet('/lego/parts/', { bricklink_id: blId, page_size: 20 })
    .catch(() => null);
  if (!gefiltert) return null;
  // Mehr als tausend Treffer fuer EINE Nummer kann der Filter nicht gemeint
  // haben — dann wurde er ignoriert.
  if (Number(gefiltert.count) > 1000) { filterWirkungslos = true; return null; }
  for (const t of gefiltert.results ?? []) {
    if (traegtBlNummer(t, blId)) return String(t.part_num);
  }
  return null;
}

/** Ob der Filter inzwischen als wirkungslos erkannt wurde — fuer den Bericht. */
function blFilterWirkungslos(): boolean { return filterWirkungslos; }

/** Ein kleiner Abruf mit dem gespeicherten Schlüssel — für den Testknopf der Einrichtung. */
async function pruefeRebrickableZugang(): Promise<void> {
  await rbGet('/lego/themes/', { page_size: 1 });
}

export { rebrickableJson, pruefeRebrickableZugang, lookupPart, getSetInfo, getAllSetParts, downloadFile, scrapeInstructions,
  getSetMinifigs, getMinifigInfo, getBrickColors, getRbKey, sleep, httpsGetRobust, getMinifigParts,
  blTeilZuRb, blFilterWirkungslos };
