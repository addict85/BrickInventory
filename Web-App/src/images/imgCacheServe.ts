import fs from 'node:fs';
import { queueThumb } from './proxyThumbs';
import { previewType } from './thumbs';
import { beforeThe, withoutMissingFile, reportError } from '../infra/error';
import { processWide } from '../infra/processWide';
import path from 'node:path';
import { APP_ROOT, SET_IMAGES_DIR } from '../infra/appPaths';
import type { ImagesContext } from './context';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

/** Only a type from the list, never the CDN's raw header: "image/png, text/html"
 * would be read as HTML by a browser. Everything else becomes JPEG, harmless with nosniff. */
export function imageType(raw: string): string {
  const type = beforeThe(raw, ';').trim().toLowerCase();
  return IMAGE_TYPES.has(type) ? type : 'image/jpeg';
}

/** What can be delivered from the disk cache; sending happens in
 * src/images/http/imageCacheDelivery.ts. */
export interface CacheHits {
  file: string;
  typ: string;
  size: number | null;
  etag: string | null;
}

/** null means: not in the cache, the caller fetches from the CDN. */
export async function cacheHit(
  k: ImagesContext,
  opts: {
    cacheFile: string;
    thumbFile: string;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
  },
): Promise<CacheHits | null> {
  const { cacheFile, thumbFile, wantThumb, createMay, note } = opts;

  if (wantThumb) {
    try {
      await fs.promises.access(thumbFile);
      const tst = await fs.promises.stat(thumbFile).catch(withoutMissingFile('bild-cache:stat', null));
      // An empty or too small preview is not an image (legacy data, aborted
      // run): fall back to the original and resize again.
      if (!tst || tst.size < 200) {
        await fs.promises.unlink(thumbFile).catch(withoutMissingFile('bild-cache:unlink'));
        throw new Error('unbrauchbare Vorschau verworfen');
      }
      return {
        file: thumbFile,
        typ: await previewType(thumbFile),
        size: tst.size,
        etag: `"t-${tst.size}-${Math.floor(tst.mtimeMs)}"`,
      };
    } catch (_) {
      /* not created yet */
    }
  }

  try {
    // Async: the cache hit is the hottest path and should not block the
    // event loop.
    await fs.promises.access(cacheFile);

    if (wantThumb) {
      // Do NOT wait for the resize: the original goes out immediately, otherwise
      // seconds of Jimp would line up for a tile wall.
      if (createMay) queueThumb(k, cacheFile, thumbFile);
      else note();
    }

    // Only images from the cache too; when in doubt JPEG — with nosniff the harmless
    // interpretation.
    const ctRaw = await fs.promises
      .readFile(cacheFile + '.ct', 'utf8')
      .catch(withoutMissingFile('bild-cache:typ', 'image/jpeg'));
    const cst = await fs.promises.stat(cacheFile).catch(withoutMissingFile('bild-cache:stat', null));
    // The cap deletes by last use; under noatime nobody else remembers
    // that. mtime stays, it is part of the ETag.
    if (cst && k.clock.now() - cst.atimeMs > 86_400_000)
      fs.promises.utimes(cacheFile, k.clock.datum(), cst.mtime).catch(withoutMissingFile('bild-cache:utimes'));
    return {
      file: cacheFile,
      typ: imageType(ctRaw),
      size: cst?.size ?? null,
      etag: cst ? `"c-${cst.size}-${Math.floor(cst.mtimeMs)}"` : null,
    };
  } catch (_) {
    /* Cache miss or error — continue loading normally */
  }

  return null;
}

const CACHE_DIR = () => path.join(APP_ROOT, 'data', 'img_proxy_cache');

/** Untouched for 30 days → gone; afterwards, if the cache is still above the
 * limit, the images unused the longest including .ct and preview. */
export async function cleanImageCacheOn(maxBytes: number, now: number): Promise<number> {
  const cacheDir = CACHE_DIR();
  const files = await fs.promises.readdir(cacheDir).catch(withoutMissingFile('bildcache:lesen', [] as string[]));
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const groups = new Map<string, { files: string[]; bytes: number; lastUsed: number }>();
  let route = 0,
    sum = 0;
  for (const f of files) {
    const p = path.join(cacheDir, f);
    const st = await fs.promises.stat(p).catch(withoutMissingFile('img-cache:stat', null));
    if (!st?.isFile()) continue;
    // atime AND mtime: under noatime atime stays at the creation time.
    if (
      st.atimeMs < cutoff &&
      st.mtimeMs < cutoff &&
      (await fs.promises.unlink(p).then(
        () => true,
        () => false,
      ))
    ) {
      route++;
      continue;
    }
    const g = groups.get(f.slice(0, 40)) ?? { files: [], bytes: 0, lastUsed: 0 };
    g.files.push(p);
    g.bytes += st.size;
    g.lastUsed = Math.max(g.lastUsed, st.atimeMs, st.mtimeMs);
    groups.set(f.slice(0, 40), g);
    sum += st.size;
  }
  // images/sets counts but is not cleared: the set images apply permanently, the cap
  // applies to everything the proxy puts on disk.
  for (const f of await fs.promises
    .readdir(SET_IMAGES_DIR)
    .catch(withoutMissingFile('bildcache:sets', [] as string[]))) {
    const st = await fs.promises.stat(path.join(SET_IMAGES_DIR, f)).catch(withoutMissingFile('img-cache:stat', null));
    if (st?.isFile()) sum += st.size;
  }
  if (sum <= maxBytes) return route;
  // Down to 90 % instead of just below the limit: otherwise it would start again right away.
  for (const g of [...groups.values()].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (sum <= maxBytes * 0.9) break;
    for (const d of g.files)
      if (
        await fs.promises.unlink(d).then(
          () => true,
          () => false,
        )
      )
        route++;
    sum -= g.bytes;
  }
  return route;
}

/** Between two daily runs the cache can grow quickly; after every tenth of the limit
 * in new bytes it is therefore capped immediately. */
export function rememberCacheGrowth(bytes: number, max: number): void {
  const z = processWide('imageCacheGrowth', () => ({ bytes: 0, running: false }));
  z.bytes += bytes;
  if (z.running || z.bytes < max / 10) return;
  z.bytes = 0;
  z.running = true;
  cleanImageCacheOn(max, Date.now())
    .catch(e => reportError('bild-cache:deckel', e))
    .finally(() => {
      z.running = false;
    });
}
