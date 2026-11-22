/** Image proxy for foreign CDNs: images come via the own server so that the
 * CSP needs no foreign sources and every image is fetched only once.
 * The fetch is done by clients/imageCdn.ts; cache, throttle and response live here. */
import path from 'node:path';
import { APP_ROOT, PUBLIC_DIR, SET_IMAGES_DIR } from '../../infra/appPaths';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { processWide } from '../../infra/processWide';
import type { AccountServices } from '../../account';
import { userIdTheRequest } from '../../account/http/login';
import { beforeThe, withoutMissingFile, errorMessage, reportError } from '../../infra/error';
import { streamFileToResponse } from '../../http/httpResponse';
import { rememberCacheGrowth, imageType } from '../imgCacheServe';
import { deliverFromCache } from './imageCacheDelivery';
import { imgProxyFailures, countProxyError } from '../imgProxyStats';
import { proxyAddress, proxyCacheKey } from '../images';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { FetchError, type FetchStream } from '../../infra/fetch';
import { IMAGE_HEADERS, IMAGE_HEADERS_WITHOUT_REFERER } from '../../externalSources';
import zlib from 'node:zlib';
import { setImageComplete } from '../setImages';
import { ALLOWED_IMAGE_HOSTS, hostAllowed } from '../../infra/foreignAddresses';

import { onceDecoded, urlOrNull } from '../../infra/validate';
import type { ImagesServices } from '../area';

/** What the proxy needs from the application: catalog (cache, preview, reservation) and account (login, tick). */
export interface ImageServices {
  images: ImagesServices;
  account: AccountServices;
}
/** 20 MB, because large set images would otherwise never land in memory completely. */
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024;

// Failures are counted by src/images/imgProxyStats.ts, otherwise they cannot be narrowed down.

/** 200 with a placeholder instead of 404: both UIs show the placeholder
 * anyway, and the browser console stays free of error lines. */
function sendPlaceholder(res: Response) {
  // Once from disk: a few hundred bytes, needed dozens of times while paging.
  const placeholder = processWide('platzhalterBild', () => {
    try {
      return fs.readFileSync(path.join(PUBLIC_DIR, 'assets', 'set-placeholder.svg'));
    } catch (e) {
      // Exception: without a readable placeholder the proxy answers 404; the image really is missing.
      reportError('bild-proxy:platzhalter', e);
      return Buffer.alloc(0);
    }
  });
  if (!placeholder.length) {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(404).end();
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).end(placeholder);
}

/** First with referer, then without; a 404 is remembered. `ersatz` answers instead of
 * the error if it can (e.g. with the preview from the cache).
 * @returns null if already answered */
async function fromCdn(
  d: ImageServices,
  url: string,
  cacheKey: string,
  res: Response,
  ersatz: () => Promise<boolean> = async () => false,
): Promise<FetchStream | null> {
  // Uncompressed: a compressed body would silently yield a white area.
  const HEADER_SETS = [
    { ...IMAGE_HEADERS, 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity' },
    { ...IMAGE_HEADERS_WITHOUT_REFERER, 'Accept-Encoding': 'identity' },
  ] as const;

  const openCdn = (kopfzeilen: Record<string, string>) =>
    d.images.openImage(url, { maxBytes: PROXY_CACHE_MAX_BYTES, zeitlimitMs: 25_000, kopfzeilen, pool: true });
  let r: FetchStream;
  try {
    r = await openCdn(HEADER_SETS[0]);
    // Follow up once without referer BEFORE the address counts as dead: the
    // hotlink protection likes to answer an unsuitable referer with 404.
    if (r.status === 404 || r.status === 403) {
      r.verwerfen();
      r = await openCdn(HEADER_SETS[1]);
    }
  } catch (e) {
    const time = e instanceof FetchError && e.reason === 'time_limit';
    if (time) imgProxyFailures.timeout++;
    else imgProxyFailures.error++;
    imgProxyFailures.lastError = errorMessage(e);
    console.error(`[img-proxy] ${time ? 'Zeitüberschreitung nach 25 s' : 'Verbindungsfehler'}: ${errorMessage(e)}`);
    if (await ersatz()) return null;
    if (!res.headersSent) res.status(time ? 504 : 502).end();
    return null;
  }
  if (r.status !== 200) {
    r.verwerfen();
    // Remember ONLY 404: with a tile wall, 403 is often just throttling.
    if (r.status === 404) {
      d.images.rememberMissing(cacheKey);
    }
    if (r.status === 404) imgProxyFailures.notFound++;
    else imgProxyFailures.other++;
    imgProxyFailures.lastError = `HTTP ${r.status} — ${url}`;
    // 404 is information, not an error: as `error` it would clog the log.
    const message = `[img-proxy] CDN antwortete ${r.status} (auch ohne Referer): ${url}`;
    if (r.status === 404) console.info(message);
    else console.error(message);
    if (await ersatz()) return null;
    void (r.status === 404 ? sendPlaceholder(res) : res.status(r.status || 502).end());
    return null;
  }
  return r;
}

/** What the proxy has completely becomes the set image: a second fetch from the CDN
 * failed where the first worked. The preview is created by the job bildbedarf. */
async function storeAsSetImage(d: ImageServices, cacheFile: string, setNumber: string): Promise<void> {
  const target = path.join(SET_IMAGES_DIR, `${setNumber.replace(/[^a-z0-9-]/gi, '_')}.jpg`);
  const teil = `${target}.${process.pid}-${randomUUID()}.teil`;
  await fs.promises.mkdir(SET_IMAGES_DIR, { recursive: true });
  await fs.promises.copyFile(cacheFile, teil);
  await fs.promises.rename(teil, target);
  rememberCacheGrowth((await fs.promises.stat(target)).size, d.images.imageLimits().cacheMaxBytes);
}

/** The decompressed stream goes into the cache on the side — first into .tmp, then atomically. */
function intoCache(
  d: ImageServices,
  body: Readable,
  res: Response,
  o: {
    url: string;
    cacheDir: string;
    cacheFile: string;
    thumbFile: string;
    contentType: string;
    enc: string;
    expected: number;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
    setNummer: string | null;
  },
): void {
  const { url, cacheDir, cacheFile, thumbFile, contentType, enc, expected, wantThumb, createMay, note } = o;
  fs.mkdirSync(cacheDir, { recursive: true });
  // Unique per REQUEST: otherwise concurrent ones would write into the same file.
  const tmpFile = `${cacheFile}.tmp-${process.pid}-${randomUUID()}`;
  const ws = fs.createWriteStream(tmpFile);
  let bytes = 0,
    aborted = false;
  const discard = (reason: string) => {
    if (aborted) return;
    aborted = true;
    ws.destroy();
    fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink'));
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `${reason}: ${url}`;
    console.error(`[img-proxy] ${reason} — weder gecacht noch verkleinert: ${url}`);
  };
  // The decompressed stream counts: compressed data must not grow arbitrarily either.
  body.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > PROXY_CACHE_MAX_BYTES) {
      discard(`grösser als ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB`);
      body.destroy();
      res.destroy();
    }
  });
  body.on('error', (e: Error) => {
    discard(`Abruf abgebrochen (${e.message})`);
    res.destroy();
  });
  // The DECOMPRESSED stream goes into the cache — the file is always a real image.
  body.pipe(ws);
  ws.on('finish', async () => {
    if (aborted) return;
    try {
      // Only complete: a truncated one would go out with 200 permanently.
      const st = await fs.promises.stat(tmpFile);
      if (!enc && expected > 0 && st.size !== expected) {
        console.error(`[img-proxy] unvollständig (${st.size}/${expected} Bytes), nicht gecacht: ${url}`);
        await fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink'));
        return;
      }
      await fs.promises.writeFile(cacheFile + '.ct', contentType);
      await fs.promises.rename(tmpFile, cacheFile);
      rememberCacheGrowth(st.size, d.images.imageLimits().cacheMaxBytes);
      if (o.setNummer)
        await setImageFromCache(d, url, o.setNummer, cacheFile).catch(e => countProxyError('img-proxy:setbild', e));
      // Create it right away, otherwise later for a whole tile wall at once.
      if (wantThumb) {
        if (createMay) d.images.queueThumb(cacheFile, thumbFile);
        else note();
      }
    } catch (_) {
      fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink'));
    }
  });
  ws.on('error', () => fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink')));
}

/** Decompress, even if identity was requested: not every CDN sticks to it.
 * A wrong length makes the browser wait; it is counted. */
function unpacked(raw: Readable, enc: string, res: Response, url: string, expected: number): Readable {
  let body: Readable = raw;
  if (enc === 'gzip' || enc === 'deflate' || enc === 'br') {
    const dec =
      enc === 'br' ? zlib.createBrotliDecompress() : enc === 'gzip' ? zlib.createGunzip() : zlib.createInflate();
    dec.on('error', () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    body = raw.pipe(dec);
    // The announced length applies to the compressed body.
    res.removeHeader('Content-Length');
    console.log(`[img-proxy] entpacke ${enc}: ${url}`);
  }
  let sentToClient = 0;
  body.on('data', (c: Buffer) => {
    sentToClient += c.length;
  });
  res.on('finish', () => {
    if (!enc && expected > 0 && sentToClient !== expected) {
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Länge weicht ab: ${sentToClient}/${expected} — ${url}`;
      console.error(`[img-proxy] an den Client gingen ${sentToClient} von ${expected} Bytes: ${url}`);
    }
  });
  return body;
}

const liesDa = (file: string) =>
  fs.promises.access(file).then(
    () => true,
    () => false,
  );

/** @returns true if image or preview are still missing under images/sets */
async function setImageMissing(d: ImageServices, setNumber: string, source: string): Promise<boolean> {
  if (!(await setImageComplete(setNumber))) return true;
  // If both are already there, often only the entry is missing: afterwards the UI no longer
  // asks here. Without waiting — a write error must not hold up delivery.
  void d.images.reportSetImageLoaded(setNumber, source).then(ok => {
    if (!ok) countProxyError('img-proxy:setBildLokal', new Error('Eintrag des Set-Bilds gescheitert'));
  });
  return false;
}

/** Only what the proxy has as an image (cache or throttled fetch) is reserved,
 * and once per set within a period (imageOnceReserve): otherwise an account with
 * invented set numbers would fill the image job's notes. */
function reserveOnce(d: ImageServices, url: string, setNumber: string): void {
  d.images.imageOnceReserve(url, setNumber);
}

function fromSetImages(
  d: ImageServices,
  req: Request,
  res: Response,
  setNumber: string,
  wantThumb: boolean,
): Promise<boolean> {
  const master = path.join(SET_IMAGES_DIR, setNumber.replace(/[^a-z0-9-]/gi, '_'));
  return deliverFromCache(d.images, {
    res,
    req,
    cacheFile: `${master}.jpg`,
    thumbFile: `${master}_thumb.jpg`,
    wantThumb,
    createMay: false,
    note: () => {},
    streamFileToResponse,
  });
}

/** From the proxy's cache to images/sets, then reserve; without a cache file nothing. */
async function setImageFromCache(d: ImageServices, url: string, setNumber: string, cacheFile: string): Promise<void> {
  try {
    await storeAsSetImage(d, cacheFile, setNumber);
  } catch (e) {
    return withoutMissingFile('img-proxy:setbild')(e);
  }
  reserveOnce(d, url, setNumber);
}

export async function passThroughImage(d: ImageServices, req: Request, res: Response) {
  // Without mandatory login an open proxy (bandwidth, IP obfuscation).
  const proxyUserId = await userIdTheRequest(d.account, req);
  if (!proxyUserId) return res.status(401).end();
  const target = proxyTarget(String(req.query.url || ''));
  if (typeof target === 'number') return res.status(target).end();
  const url = target;
  // Fetch every image only once; Content-Type lies next to it (.ct).
  const cacheDir = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey = proxyCacheKey(url);
  const cacheFile = path.join(cacheDir, cacheKey);
  // ?thumb=1: part images are not available in reduced size on the CDN.
  const wantThumb = req.query.thumb === '1';
  // gen=0: the request computes nothing, it leaves a note for the
  // job 'image_demand' — throttled and only in the job process.
  const createMay = req.query.gen !== '0';
  const setNumber = setNumberFromImageAddress(String(url || ''));
  const thumbFile = cacheFile + '_thumb.jpg';
  // A set image including preview belongs in images/sets; the image job fetches it
  // as soon as it was requested once via the proxy.
  const setMissing = setNumber ? await setImageMissing(d, setNumber, url) : false;
  // images/sets applies to all accounts and has no cap: store and reserve only for a set
  // in the account's scope, otherwise an account would fill the disk with invented numbers.
  const store = setMissing && !!setNumber && (await d.images.setNumberInScope(proxyUserId, setNumber));
  const note = () => {
    if (store && setNumber) d.images.rememberUsed(String(url), setNumber);
  };
  // If only the preview is left in the cache (maintenance deletes the unused original
  // after 30 days), the proxy fetches the original anew: the CDN rejects the image job's fetch
  // with its own identifier; without this path the set would never get a file.
  const originalMissing = store && !(await liesDa(cacheFile));
  if (store && setNumber && !originalMissing) await setImageFromCache(d, url, setNumber, cacheFile);

  // If the set image including preview lies in images/sets, it comes from there instead of from
  // cache or CDN: maintenance clears the proxy cache after 30 days, images/sets not.
  if (setNumber && !setMissing && (await fromSetImages(d, req, res, setNumber, wantThumb))) return;
  const fromCache = () =>
    deliverFromCache(d.images, {
      res,
      req,
      cacheFile,
      thumbFile,
      wantThumb,
      createMay,
      note,
      streamFileToResponse,
    });
  // If the new fetch fails, the preview from the cache stays.
  const ersatz = async () => originalMissing && (await fromCache());
  if (!originalMissing && (await fromCache())) return;

  // The flag (one hour) spares the CDN the question on every page view.
  if (d.images.isKnownMissing(cacheKey) && (await ersatz())) return;
  if (d.images.isKnownMissing(cacheKey)) return sendPlaceholder(res);

  // Only fetches from the CDN count: each one fills disk and bandwidth, hits do not.
  const tick = await d.account.countRequest('bild-abruf', `konto:${proxyUserId}`, 60_000);
  if (tick.count > d.images.imageLimits().fetchesJeMinute) {
    if (await ersatz()) return;
    res.setHeader('Retry-After', String(tick.waitMin * 60));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).end();
  }

  const r = await fromCdn(d, url, cacheKey, res, ersatz);
  if (!r) return;
  const setTarget = store ? setNumber : null;
  return forward(d, r, res, { url, cacheDir, cacheFile, thumbFile, wantThumb, createMay, note, setTarget });
}

/** The address from ?url=, or the status with which it is rejected. */
function proxyTarget(raw: string): string | number {
  let url = raw;
  if (!url?.startsWith('https://')) return 400;
  // Rebrickable sometimes delivers pre-encoded addresses — decode once.
  const decoded = onceDecoded(url);
  if (decoded.startsWith('https://')) url = decoded;
  // Only known image CDNs; an unreadable address is 403 as well.
  if (!hostAllowed(url, ALLOWED_IMAGE_HOSTS)) return 403;
  return proxyAddress(url) ?? url;
}

/** The CDN's response to the client and at the same time into the cache. */
function forward(
  d: ImageServices,
  r: FetchStream,
  res: Response,
  o: {
    url: string;
    cacheDir: string;
    cacheFile: string;
    thumbFile: string;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
    setTarget: string | null;
  },
) {
  const { url, cacheDir, cacheFile, thumbFile, wantThumb, createMay, note, setTarget } = o;
  const rawType = String(r.kopf['content-type'] || 'image/jpeg');

  // Images only: the allowed CDNs partly host user uploads, and an SVG
  // or HTML would otherwise run under our origin.
  const mime = beforeThe(rawType, ';').trim().toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
    r.verwerfen();
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `Kein Bild (${mime}) — ${url}`;
    console.warn(`[img-proxy] Antwort ist kein Bild (${mime}): ${url}`);
    return res.status(415).end();
  }

  // Only a complete file may go into the cache.
  const expected = parseInt(String(r.kopf['content-length'] || '0'), 10) || 0;
  const contentType = imageType(rawType);
  res.setHeader('Content-Type', contentType);
  // With length: a reverse proxy might buffer a chunked response for a long time.
  if (expected > 0) res.setHeader('Content-Length', String(expected));

  const enc = String(r.kopf['content-encoding'] || '').toLowerCase();
  const raw = r.stream();
  const body = unpacked(raw, enc, res, url, expected);
  // Short: streamed unchecked, a long max-age would nail errors in the browser.
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');

  intoCache(d, body, res, {
    url,
    cacheDir,
    cacheFile,
    thumbFile,
    contentType,
    enc,
    expected,
    wantThumb,
    createMay,
    note,
    setNummer: setTarget,
  });

  // Abort while scrolling: the CDN connection must go back to the pool immediately.
  res.on('close', () => {
    if (res.writableFinished || !res.destroyed) return;
    console.log(`[img-proxy] Client hat abgebrochen, Verbindung freigegeben: ${url}`);
    raw.destroy();
  });

  body.pipe(res);
}

/** The image is stored under this number for all accounts; that is why only
 * the whole path without the query part counts, otherwise `…/parts/x.png?/media/sets/10294-1.jpg`
 * would store a foreign image as a set. */
export function setNumberFromImageAddress(address: string): string | null {
  const u = urlOrNull(address);
  if (u?.protocol !== 'https:' || u.hostname !== 'cdn.rebrickable.com' || u.search || u.hash) return null;
  // Only the main image: under /media/sets/<set>/<n>.jpg there are additional images; the first one requested
  // would otherwise become the set image for all accounts.
  const m = /^\/media\/sets\/([A-Za-z0-9-]{1,40})\.jpg$/.exec(u.pathname);
  return m?.[1] ?? null;
}
