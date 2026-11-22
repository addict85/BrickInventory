// An API client, not a router: that is why it does not live under routes/.
import { NO_COLOR } from '../src/infra/validate';

import { pipeline } from 'node:stream/promises';
import { holeHttps, openHttps, FetchError, type FetchResponse, type FetchStream } from '../src/infra/fetch';
import path from 'node:path';
import fs from 'node:fs';
import { errorMessage, reportAndDeliver, reportError } from '../src/infra/error';
import { withVersion } from '../src/infra/setNumber';
import type { ClientsAccess } from './access';
import { attempts } from '../src/infra/result';
import type { z } from 'zod';
import {
  RbSet,
  RbThema,
  RbTeil,
  RbSetTeil as RbSetTeilSchema,
  RbSetMinifig,
  RbMinifig,
  RbColor,
  RbPartColor,
  rbPage,
  checkResponse,
} from './responses';
import {
  ALLOWED_DOWNLOAD_HOSTS,
  ALLOWED_API_HOSTS,
  ALLOWED_REBRICKABLE_HOSTS,
  hostAllowed,
  pathSegment,
} from '../src/infra/foreignAddresses';

const BASE = 'https://rebrickable.com/api/v3';

/** A part row as /lego/sets/{id}/parts returns it. */
export type RbSetTeil = z.output<typeof RbSetTeilSchema>;
const SetPartPage = rbPage(RbSetTeilSchema);

/** The Rebrickable key from the central settings. */
async function getRbKey(kl: Rb): Promise<string | null> {
  return (await kl.zugang.schluessel('rebrickable_api_key')) || null;
}

/** When in doubt let it through: an exceeded daily quota only costs
 * calls — the opposite of the login counter, where the fallback locks. */
async function dailyQuotaFree(kl: Rb): Promise<boolean> {
  const r = await attempts('takt:kontingentPruefenUndZaehlen', kl.zugang.zaehle('rebrickable'));
  return r.ok ? r.wert.allowed : true;
}

/** Response: {"detail": "… Expected available in 2 seconds."} */
export function parseThrottleWait(body: string) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    const match = data?.detail?.match(/(\d+)\s*second/);
    if (match) return parseInt(match[1], 10) * 1000 + 500;
  } catch (e) {
    reportError('kontingent:retry-after-lesen', e);
  }
  return 5000;
}

/** A GET with daily quota and throttle. Every failure (no key, quota, network, status) is
 * null: the callers then search on the next path. */
async function rebrickableJson<T extends z.ZodType>(kl: Rb, path: string, schema: T): Promise<z.output<T> | null> {
  const key = await getRbKey(kl);
  if (!key) return null;
  if (!(await dailyQuotaFree(kl))) {
    console.log(`[rebrickable] Tageslimit erreicht — ${path} übersprungen`);
    return null;
  }
  await kl.zugang.drossel.foreground.waitForSlot();
  // Exception: one source among several; without an answer the own catalog applies.
  try {
    const r = await httpsGetRobust(kl, `${BASE}${path}`, { Authorization: `key ${key}` }, 8000);
    return r.status === 200 ? checkResponse('Rebrickable', schema, JSON.parse(r.body)) : null;
  } catch (e) {
    return reportAndDeliver(`rebrickable:${path}`, null)(e);
  }
}

/** Rebrickable API responses are paged; 32 MB is plenty for each page. */
const API_MAX_BYTES = 32 * 1024 * 1024;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Three attempts on 429 and network errors; at Rebrickable 403 means "unknown". */
async function httpsGetRobust(
  kl: Rb,
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 60000,
): Promise<{ status: number; body: string; buffer: Buffer }> {
  const hosts = Object.keys(headers).some(k => k.toLowerCase() === 'authorization')
    ? ALLOWED_REBRICKABLE_HOSTS
    : ALLOWED_API_HOSTS;
  for (let attempt = 1; ; attempt++) {
    let r: FetchResponse;
    try {
      r = await holeHttps(url, {
        hosts,
        maxBytes: API_MAX_BYTES,
        zeitlimitMs: timeoutMs,
        kopfzeilen: { 'User-Agent': BROWSER_UA, ...headers },
      });
    } catch (e) {
      if (e instanceof FetchError && e.isTransient && attempt < 3) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
    if (r.status === 429) {
      const wait = parseThrottleWait(r.koerper.toString('utf-8'));
      console.log(`[rebrickable] 429 throttled, waiting ${wait}ms...`);
      kl.zugang.drossel.foreground.throttle(wait);
      if (attempt < 3) {
        await sleep(wait);
        continue;
      }
      return { status: 429, body: '', buffer: Buffer.alloc(0) };
    }
    if (r.status === 403) return { status: 403, body: '', buffer: Buffer.alloc(0) };
    return { status: r.status, body: r.koerper.toString('utf-8'), buffer: r.koerper };
  }
}

/** A request without its own retry: the caller (background runs) handles throttle
 * and daily quota. A network error is status 0, not a throw. */
export async function rebrickableRaw(url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return holeHttps(url, {
    hosts: ALLOWED_REBRICKABLE_HOSTS,
    maxBytes: API_MAX_BYTES,
    zeitlimitMs: 30_000,
    kopfzeilen: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventory/1.0' },
  }).then(
    r => ({ status: r.status, body: r.koerper.toString('utf8') }),
    (e: unknown) => {
      reportError('rebrickable:abruf', e);
      return { status: 0, body: '' };
    },
  );
}

/** No further request can succeed; loops over many numbers abort. */
export class RebrickableLocked extends Error {
  constructor(
    readonly reason: 'quota' | 'no_key',
    text: string,
  ) {
    super(text);
  }
}

async function rbGet<T extends z.ZodType>(
  kl: Rb,
  apiPath: string,
  schema: T,
  params: Record<string, string | number> = {},
): Promise<z.output<T> | null> {
  const key = await getRbKey(kl);
  if (!key) throw new RebrickableLocked('no_key', 'Rebrickable API Key nicht konfiguriert.');
  await kl.zugang.drossel.foreground.waitForSlot();
  if (!(await dailyQuotaFree(kl))) {
    // The number from the shared counter, so the text follows the limit.
    const { limit } = await kl.zugang.quotaStatus('rebrickable');
    throw new RebrickableLocked('quota', `Rebrickable Tageslimit erreicht (${limit}/Tag). Versuche es morgen wieder.`);
  }
  const qs = new URLSearchParams({ page_size: '500', ...params }).toString();
  const { status, body } = await httpsGetRobust(kl, `${BASE}${apiPath}?${qs}`, { Authorization: `key ${key}` }, 45000);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Rebrickable ${status}: ${body.substring(0, 150)}`);
  return checkResponse('Rebrickable', schema, JSON.parse(body));
}

async function getThemeName(kl: Rb, themeId: number | string) {
  if (!themeId) return null;
  if (kl.themen.has(themeId)) return kl.themen.get(themeId);
  const d = await rbGet(kl, `/lego/themes/${pathSegment(themeId)}/`, RbThema);
  const name = d?.name || null;
  kl.themen.set(themeId, name);
  return name;
}

/** The master data of a set; null if Rebrickable does not know it. */
async function holeSet(kl: Rb, number: string) {
  return rbGet(kl, `/lego/sets/${pathSegment(number)}/`, RbSet);
}

/** The part list page by page. `verweigert`: Rebrickable answered 403 (set unknown or no
 * access) — the caller should notice that. */
async function fetchSetParts(kl: Rb, n: string): Promise<{ parts: RbSetTeil[]; verweigert: boolean }> {
  const key = await getRbKey(kl);
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  const allParts: RbSetTeil[] = [];
  let url: string | null = `${BASE}/lego/sets/${pathSegment(n)}/parts/?page_size=500&inc_part_details=1`;
  let pages = 0;
  while (url && pages++ < 40) {
    if (!(await dailyQuotaFree(kl))) {
      console.error(
        `[rebrickable] Tageslimit (${(await kl.zugang.quotaStatus('rebrickable')).limit}/Tag) erreicht — ${n} übersprungen`,
      );
      break;
    }
    await kl.zugang.drossel.foreground.waitForSlot();
    let status: number, body: string;
    try {
      ({ status, body } = await httpsGetRobust(kl, url, { Authorization: `key ${key}` }, 60000));
    } catch (e) {
      console.error(`  Parts page ${pages} failed: ${errorMessage(e)}`);
      break;
    }
    if (status === 403) {
      console.log(`  Parts HTTP 403 for ${n} — set not found or access denied, skipping`);
      return { parts: allParts, verweigert: true };
    }
    if (status === 404) break;
    if (status !== 200) {
      console.error(`  Parts HTTP ${status}`);
      break;
    }
    let data: z.output<typeof SetPartPage>;
    try {
      data = checkResponse('Rebrickable', SetPartPage, JSON.parse(body));
    } catch (e) {
      reportError('rebrickable:teile-seite', e);
      break;
    }
    allParts.push(...(data.results || []));
    // Otherwise a foreign `next` would receive the key.
    url = data.next && hostAllowed(String(data.next), ALLOWED_REBRICKABLE_HOSTS) ? data.next : null;
    if (data.next && !url)
      console.error(`  Parts page ${pages}: next zeigt auf einen fremden Host, ${n} bleibt unvollständig`);
    if (url) await sleep(500);
  }
  return { parts: allParts, verweigert: false };
}

async function scrapeInstructions(kl: Rb, setNumber: string) {
  const n = withVersion(setNumber);
  const { status, body } = await httpsGetRobust(
    kl,
    `https://rebrickable.com/sets/${pathSegment(n)}/`,
    { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    8000,
  );
  if (status !== 200) return [];
  const found: { url: string; description: string }[] = [];
  for (const re of [
    /href="(https?:\/\/[^"]*lego\.com[^"]*\.pdf[^"]*)"/gi,
    /href="(https?:\/\/cdn\.rebrickable\.com\/media\/instructions[^"]+\.pdf[^"]*)"/gi,
    /href="(https?:\/\/assets\.lego\.com[^"]*\.pdf[^"]*)"/gi,
  ]) {
    for (const m of body.matchAll(re)) {
      // As a constant, because the callback does not know `m` as non-null.
      const hits = m[1];
      if (hits && !found.find(f => f.url === hits)) found.push({ url: hits, description: `Anleitung ${n}` });
    }
  }
  return found;
}

/** Upper limit per file (an instruction rarely exceeds 150 MB): a server that sends endlessly
 * would otherwise fill the disk. Aborted within the stream. */
export const DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024;

/** `anfang`: what the file must start with (instructions: `%PDF-`), otherwise it does not land in the shared cache. */
async function downloadFile(url: string, destPath: string, maxBytes = DOWNLOAD_MAX_BYTES, start?: Buffer) {
  if (fs.existsSync(destPath)) return true;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  // What lands here, the server delivers to every account: hence the
  // host list on every hop, not only on the first address.
  let reply: FetchStream;
  try {
    reply = await openHttps(url, {
      hosts: ALLOWED_DOWNLOAD_HOSTS,
      maxBytes,
      zeitlimitMs: 10 * 60_000,
      kopfzeilen: {
        'User-Agent': BROWSER_UA,
        Referer: 'https://rebrickable.com/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
  } catch (e) {
    console.warn(`[download] ${errorMessage(e)}`);
    return false;
  }
  if (reply.status !== 200) {
    reply.verwerfen();
    return false;
  }
  try {
    await pipeline(reply.stream(), fs.createWriteStream(destPath));
  } catch (e) {
    console.warn(`[download] Abgebrochen: ${errorMessage(e)}`);
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  if ((await fs.promises.stat(destPath)).size < 100) {
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  if (start && !(await beginsWith(destPath, start))) {
    console.warn(`[download] Anfang der Datei passt nicht, verworfen: ${url}`);
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  return true;
}

async function beginsWith(file: string, start: Buffer): Promise<boolean> {
  const f = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.alloc(start.length);
    const { bytesRead } = await f.read(header, 0, start.length, 0);
    return bytesRead === start.length && header.equals(start);
  } finally {
    await f.close();
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function getSetMinifigs(kl: Rb, setNumber: string) {
  const n = withVersion(setNumber);
  try {
    const key = await getRbKey(kl);
    if (!key) return [];
    await kl.zugang.drossel.hintergrund.waitForSlot();
    const { status, body } = await httpsGetRobust(
      kl,
      `${BASE}/lego/sets/${pathSegment(n)}/minifigs/?page_size=100`,
      { Authorization: `key ${key}` },
      30000,
    );
    if (status !== 200) return [];
    const data = checkResponse('Rebrickable', rbPage(RbSetMinifig), JSON.parse(body));
    return data.results.map(m => ({
      fig_number: m.set_num,
      fig_name: m.set_name ?? '',
      quantity: m.quantity || 1,
      image_url: m.set_img_url || null,
    }));
  } catch (e) {
    console.log(`  Minifigs fetch failed for ${n}: ${errorMessage(e)}`);
    return [];
  }
}

async function getMinifigInfo(kl: Rb, figNumber: string) {
  const data = await rbGet(kl, `/lego/minifigs/${pathSegment(figNumber)}/`, RbMinifig);
  if (!data) return null;
  return {
    fig_number: data.set_num || figNumber,
    fig_name: data.name || null,
    image_url: data.set_img_url || null,
  };
}

async function getBrickColors(kl: Rb) {
  if (kl.farben) return kl.farben;
  const key = await getRbKey(kl);
  if (!key) return [];
  const { status, body } = await httpsGetRobust(
    kl,
    `${BASE}/lego/colors/?page_size=500`,
    { Authorization: `key ${key}` },
    15000,
  );
  if (status !== 200) return [];
  const data = checkResponse('Rebrickable', rbPage(RbColor), JSON.parse(body));
  kl.farben = data.results.map(c => ({ id: c.id, name: c.name ?? '', hex: c.rgb || null }));
  return kl.farben;
}

/** The parts of a minifig; null without key or answer (do not remember), an error is thrown. */
async function fetchMinifigParts(
  kl: Rb,
  figNumber: string,
): Promise<{ part_num: string; color_id: number; quantity: number; bl_part_num: string | null }[] | null> {
  const key = await getRbKey(kl);
  if (!key) return null;
  if (!(await dailyQuotaFree(kl))) {
    console.error(
      `[rebrickable] Tageslimit (${(await kl.zugang.quotaStatus('rebrickable')).limit}/Tag) erreicht — Minifig-Teile für ${figNumber} übersprungen`,
    );
    return null;
  }
  await kl.zugang.drossel.foreground.waitForSlot();
  const { status, body } = await httpsGetRobust(
    kl,
    `${BASE}/lego/minifigs/${pathSegment(figNumber)}/parts/?page_size=200&inc_part_details=1`,
    { Authorization: `key ${key}` },
    30000,
  );
  if (status !== 200) return null;
  const data = checkResponse('Rebrickable', SetPartPage, JSON.parse(body));
  return data.results
    .filter(r => r.part.part_num)
    .map(r => ({
      part_num: r.part.part_num,
      color_id: r.color.id ?? 0,
      quantity: r.quantity || 1,
      bl_part_num: firstBlNumber(r.part.external_ids),
    }));
}

/** A part with its image in the chosen color; null if Rebrickable returns nothing. */
async function lookupPart(kl: Rb, partNumber: string, colorId?: number | null) {
  const key = await getRbKey(kl);
  if (!key) return null;
  await kl.zugang.drossel.hintergrund.waitForSlot();
  const { status, body } = await httpsGetRobust(
    kl,
    `https://rebrickable.com/api/v3/lego/parts/?part_nums=${encodeURIComponent(partNumber)}&page_size=1`,
    { Authorization: `key ${key}` },
    15000,
  );
  if (status !== 200) return null;
  const d = checkResponse('Rebrickable', rbPage(RbTeil), JSON.parse(body));
  const part = d.results[0];
  if (!part) return null;
  let image_url = part.part_img_url || null;

  // The image in the chosen color only comes through the parts/colors endpoint.
  if (colorId !== null && colorId !== undefined && colorId !== NO_COLOR) {
    try {
      await kl.zugang.drossel.hintergrund.waitForSlot();
      const colorResp = await httpsGetRobust(
        kl,
        `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNumber)}/colors/${colorId}/`,
        { Authorization: `key ${key}` },
        15000,
      );
      if (colorResp.status === 200) {
        const cd = checkResponse('Rebrickable', RbPartColor, JSON.parse(colorResp.body));
        if (cd.part_img_url) image_url = cd.part_img_url;
      }
    } catch (e) {
      reportError('rebrickable:farbbild', e);
    }
  }

  return {
    part_name: part.name || null,
    category_name: part.part_cat_id ? String(part.part_cat_id) : null,
    image_url,
  };
}

// BrickLink → Rebrickable for wanted lists; otherwise the tree goes the other way (external_ids).

/** The first BrickLink number of a part; Rebrickable returns them as a list. */
function firstBlNumber(ext: Record<string, unknown> | null | undefined): string | null {
  const bl = ext?.BrickLink;
  return Array.isArray(bl) && bl[0] != null ? String(bl[0]) : null;
}

function carriesBlNumber(teil: unknown, blId: string): boolean {
  const ext = (teil as { external_ids?: Record<string, unknown> } | null)?.external_ids;
  const raw = ext?.BrickLink;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { ext_ids?: unknown[] } | undefined)?.ext_ids)
      ? (raw as { ext_ids: unknown[] }).ext_ids
      : [];
  return list.some(x => String(x).toLowerCase() === blId.toLowerCase());
}

/** A BrickLink part number as Rebrickable number; null unless the mapping is proven. */
async function blPartToRb(kl: Rb, blId: string): Promise<string | null> {
  // Path 1: most parts carry the same number in both services; external_ids turns that guess
  // into a mapping.
  const direct = await rbGet(kl, `/lego/parts/${pathSegment(blId)}/`, RbTeil);
  if (direct && carriesBlNumber(direct, blId)) return String(direct.part_num);

  // Path 2: the filter, with a cross-check.
  if (kl.filterIneffective) return null;
  const filtered = await rbGet(kl, '/lego/parts/', rbPage(RbTeil), { bricklink_id: blId, page_size: 20 });
  if (!filtered) return null;
  // More than a thousand hits for ONE number cannot be what the filter
  // meant — then it was ignored.
  if (Number(filtered.count) > 1000) {
    kl.filterIneffective = true;
    return null;
  }
  for (const t of filtered.results ?? []) {
    if (carriesBlNumber(t, blId)) return String(t.part_num);
  }
  return null;
}

/** Whether the filter has meanwhile been recognized as ineffective — for the report. */
function blFilterIneffective(kl: Rb): boolean {
  return kl.filterIneffective;
}

/** A small request with the stored key — for the test button of the setup. */
async function checkRebrickableAccess(kl: Rb): Promise<void> {
  await rbGet(kl, '/lego/themes/', rbPage(RbThema), { page_size: 1 });
}

/** Access and intermediate state of a client; every function gets it as first parameter. */
interface Rb {
  zugang: ClientsAccess;
  themen: Map<number | string, string | null>;
  farben: { id: number; name: string; hex: string | null }[] | null;
  /** The answer concerns the service, not the number; only a new client asks again. */
  filterIneffective: boolean;
}

/** One client per access: what it remembers applies only to it, not to the process. */
export function createRebrickable(zugang: ClientsAccess) {
  const r: Rb = { zugang, themen: new Map(), farben: null, filterIneffective: false };
  const bound =
    <A extends unknown[], E>(f: (r: Rb, ...a: A) => E) =>
    (...a: A) =>
      f(r, ...a);
  return {
    rebrickableJson: <T extends z.ZodType>(path: string, schema: T) => rebrickableJson(r, path, schema),
    checkRebrickableAccess: bound(checkRebrickableAccess),
    lookupPart: bound(lookupPart),
    holeSet: bound(holeSet),
    fetchSetParts: bound(fetchSetParts),
    fetchMinifigParts: bound(fetchMinifigParts),
    getThemeName: bound(getThemeName),
    scrapeInstructions: bound(scrapeInstructions),
    getSetMinifigs: bound(getSetMinifigs),
    getMinifigInfo: bound(getMinifigInfo),
    getBrickColors: bound(getBrickColors),
    getRbKey: bound(getRbKey),
    httpsGetRobust: bound(httpsGetRobust),
    blPartToRb: bound(blPartToRb),
    blFilterIneffective: bound(blFilterIneffective),
  };
}

export type Rebrickable = ReturnType<typeof createRebrickable>;

export { downloadFile, sleep, firstBlNumber };
