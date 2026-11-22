// Both path prefixes, one existence cache.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { APP_ROOT, IMAGES_DIR } from '../infra/appPaths';
import path from 'node:path';
import { Zwischenspeicher } from '../infra/cache';

// Positive hits stay valid (previews are never deleted); negative ones
// are rechecked after 10 min so that freshly created ones appear.
const NEGATIVE_MS = 10 * 60 * 1000;
const _thumbCache = new Zwischenspeicher<string, boolean>(20000);

export function resolveImageLocal(localPath: string | null | undefined) {
  if (!localPath) return localPath;
  const ext = path.extname(localPath);
  const thumbPath = localPath.replace(ext, '_thumb.jpg');
  let thumbFs: string;
  if (thumbPath.startsWith('/data/')) thumbFs = path.join(APP_ROOT, thumbPath.slice(1));
  else if (thumbPath.startsWith('/images/')) thumbFs = path.join(IMAGES_DIR, thumbPath.slice('/images/'.length));
  else return localPath;

  const hit = _thumbCache.hole(thumbFs);
  if (hit !== undefined) return hit ? thumbPath : localPath;

  const exists = fs.existsSync(thumbFs);
  _thumbCache.setze(thumbFs, exists, exists ? undefined : NEGATIVE_MS);
  return exists ? thumbPath : localPath;
}

// The address is stored like this in saved image_url values; that is why the old form lives on.
export const IMG_PROXY_PATH = '/api/v1/img-proxy';
/** Only for legacy data and older app versions. */
export const IMG_PROXY_PATH_LEGACY = '/api/img-proxy';

export function isProxyPath(src: string): boolean {
  return src.startsWith(IMG_PROXY_PATH) || src.startsWith(IMG_PROXY_PATH_LEGACY);
}

/** Only images from Rebrickable go via the proxy; a substring would also match foreign hosts. */
function isRebrickableImage(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'rebrickable.com' || h.endsWith('.rebrickable.com');
  } catch {
    return false;
  }
}

export function proxyImageUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  if (isRebrickableImage(url)) return `${IMG_PROXY_PATH}?url=${encodeURIComponent(url)}`;
  return url;
}

// For callers without a stored image_local column (catalog), which would
// otherwise recheck existence on every request.
const _existsCache = new Zwischenspeicher<string, boolean>(20000);

/** Returns the preview-preferred path on a hit, otherwise null.
 * @param publicRelPath e.g. "/images/sets/10283-1.jpg" */
export function imageIfPresent(publicRelPath: string) {
  const hit = _existsCache.hole(publicRelPath);
  if (hit !== undefined) return hit ? resolveImageLocal(publicRelPath) : null;

  const fsPath = publicRelPath.startsWith('/images/')
    ? path.join(IMAGES_DIR, publicRelPath.slice('/images/'.length))
    : path.join(APP_ROOT, publicRelPath.replace(/^\//, ''));
  const exists = fs.existsSync(fsPath);
  _existsCache.setze(publicRelPath, exists, exists ? undefined : NEGATIVE_MS);
  return exists ? resolveImageLocal(publicRelPath) : null;
}

/** These CDNs deliver the same image without the query part; it only holds a
 * timestamp. With it in the key every variant would create a new file.
 * www.bricklink.com needs it (getPic.asp?…), there it is only sorted. */
const WITHOUT_REQUEST_PART = ['cdn.rebrickable.com', 'images.brickset.com', 'img.bricklink.com'];

/** The address the proxy fetches and stores by; null if unreadable. */
export function proxyAddress(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  u.hash = '';
  if (WITHOUT_REQUEST_PART.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) u.search = '';
  else u.searchParams.sort();
  return u.href;
}

export function proxyCacheKey(url: string): string {
  return crypto
    .createHash('sha1')
    .update(proxyAddress(url) ?? url)
    .digest('hex');
}

// The proxy cache's storage rule in one place, also for the image diagnostics.
export function proxyCachePathFor(url: string): string | null {
  if (!url) return null;
  return path.join(APP_ROOT, 'data', 'img_proxy_cache', proxyCacheKey(url));
}
