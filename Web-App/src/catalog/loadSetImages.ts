/** Load a set's images: parts and figures from the CDN into the own folder,
 * under a lock per set that other processes see as well. */
import { reportError, logAndContinue } from '../infra/error';
import { withVersion } from '../infra/setNumber';
import { setPartImageLocal, setMinifigImageLocal } from './catalogMaintenance';
import { IMAGE_HEADERS } from '../externalSources';

// Part and figure images live in separate folders; downloadImage()
// therefore receives the kind.
import { imageExtension, filePart, targetInFolder } from '../images';
import { ALLOWED_IMAGE_HOSTS } from '../infra/foreignAddresses';
import * as repo from './repository/partsEnrichment';
import fs from 'node:fs';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR } from '../infra/appPaths';
import type { CatalogContext } from './context';

/** How many images are still to be loaded right now; admin shows it in the tile. */
export const IMAGE_LOAD_COUNTER = 'imgdl_pending_count';
async function imageLoadCounter(k: CatalogContext, delta: number): Promise<void> {
  const d = Math.round(Number(delta) || 0);
  if (d) await k.jobQueue.countState(IMAGE_LOAD_COUNTER, d).catch(logAndContinue('teile-enrich:imgDlAdd'));
}

/** @param kind Determines target directory and web path. */
async function downloadImage(
  k: CatalogContext,
  imgUrl: string | null | undefined,
  partNum: string,
  colorId: number,
  kind: 'part' | 'minifig',
): Promise<string | null> {
  if (!imgUrl) return null;
  const IMG_DIR = kind === 'minifig' ? MINIFIG_IMAGES_DIR : PART_IMAGES_DIR;
  const webBase = kind === 'minifig' ? '/images/minifigs/' : '/images/parts/';
  // For manual parts, number and address come from the user: they may neither
  // form a path nor determine the extension.
  const nummer = filePart(partNum),
    color = filePart(colorId);
  if (!nummer || !color) return null;
  const file = `${nummer}_${color}.${imageExtension(imgUrl)}`;
  const dest = targetInFolder(IMG_DIR, file);
  if (!dest) return null;
  const rel = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!(await k.images.loadImage(imgUrl, dest, ALLOWED_IMAGE_HOSTS, IMAGE_HEADERS))) return null;
  try {
    await k.images.createPreview(rel).catch(logAndContinue('teile-enrich:vorschauErzeugenAus'));
  } catch (e) {
    reportError('teile-enrich:vorschau', e);
  }
  return rel;
}

/** An image from the CDN into the parts folder, then into the catalog. */
async function loadPartImage(k: CatalogContext, p: repo.ImageRequest): Promise<void> {
  const rawUrl = p.image_url || '';
  let cdnUrl = rawUrl;
  // Both spellings: legacy rows still carry /api/img-proxy.
  const m = rawUrl.match(/\/api\/(?:v1\/)?img-proxy\?url=(.+)/);
  if (m) cdnUrl = decodeURIComponent(m[1] ?? '');
  if (!cdnUrl.startsWith('http')) {
    console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
    return;
  }

  const nummer = filePart(p.id),
    color = filePart(p.color_id);
  if (!nummer || (p.kind !== 'fig' && !color)) {
    console.warn(`[img-dl] skipping unsafe number ${String(p.id).substring(0, 40)}`);
    return;
  }
  const file =
    p.kind === 'fig' ? `${nummer}.${imageExtension(cdnUrl)}` : `${nummer}_${color}.${imageExtension(cdnUrl)}`;
  const dest = targetInFolder(PART_IMAGES_DIR, file);
  if (!dest) return;
  const rel = `/images/parts/${file}`;

  if (!fs.existsSync(dest)) {
    await k.cdnDrossel.acquire();
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    const ok = await k.images
      .loadImage(cdnUrl, dest, ALLOWED_IMAGE_HOSTS, IMAGE_HEADERS, text =>
        console.warn(`[img-dl] ${p.id}: ${text}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')),
      )
      .finally(() => k.cdnDrossel.release());
    if (!ok) return;
  }

  // A write error aborts the run instead of leaving behind a file without a reference;
  // the next run finds the file and only writes the reference afterwards.
  if (p.kind === 'fig') await setMinifigImageLocal(k, p.id, rel);
  else await setPartImageLocal(k, p.id, p.color_id, rel);
}

/** Across processes on an OWN connection: an advisory lock is bound to
 * the session; via the pool it would be released unreliably. waitIfBusy (PDF)
 * waits for the other process, otherwise images would be missing from the PDF. */
async function fetchImageLock(
  k: CatalogContext,
  n: string,
  waitIfBusy: boolean,
): Promise<'belegt' | { lockClient: import('pg').PoolClient | null; haveXlock: boolean }> {
  let lockClient: import('pg').PoolClient | null = null,
    haveXlock = false;
  try {
    lockClient = await k.teileAnreicherung.lockConnection();
  } catch (_) {
    lockClient = null;
  }
  if (!lockClient) return { lockClient, haveXlock };
  const deadline = k.uhr.jetzt() + 180000; // wait at most 3 min for another worker
  while (true) {
    try {
      haveXlock = await repo.attemptsImageLock(lockClient, n);
    } catch (_) {
      haveXlock = false;
    }
    if (haveXlock) break;
    if (!waitIfBusy) {
      console.log(`[img-dl] ${n}: wird bereits von einem anderen Worker geladen — übersprungen`);
      lockClient.release();
      return 'belegt';
    }
    if (k.uhr.jetzt() > deadline) {
      console.warn(`[img-dl] ${n}: Wartezeit auf anderen Worker überschritten — fahre ohne Lock fort`);
      break; // best effort: continue without lock
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { lockClient, haveXlock };
}

// One lock per set: concurrent calls for the same set wait for the first one.
const sperren = (k: CatalogContext) => k.faecher.fach('setBilder:sperren', () => new Map<string, Promise<void>>());

async function downloadSetImages(k: CatalogContext, setNumber: string, waitIfBusy = false) {
  const n = withVersion(setNumber);
  const _downloadLocks = sperren(k);
  if (_downloadLocks.has(n)) {
    await _downloadLocks.get(n);
    return;
  }
  // `!` is provable: the body of a Promise constructor runs synchronously,
  // so resolveLock is set.
  let resolveLock!: () => void;
  const lock = new Promise<void>(r => {
    resolveLock = r;
  });
  _downloadLocks.set(n, lock);

  const sperre = await fetchImageLock(k, n, waitIfBusy);
  if (sperre === 'belegt') {
    resolveLock();
    _downloadLocks.delete(n);
    return;
  }
  const { lockClient, haveXlock } = sperre;

  let _pendingAdded = 0; // this batch's share of the global imgDl counter
  let _flushed = 0; // of which already reported to the counter (rest in finally)
  let _lastFlush = k.uhr.jetzt();
  try {
    const needsImg = await k.teileAnreicherung.imagesWithoutFile(n);
    if (!needsImg.length) return;

    console.log(`[img-dl] ${n}: lade ${needsImg.length} Bilder`);
    // ADD to the global counter instead of overwriting it, otherwise monitoring
    // would only show the most recently started batch.
    _pendingAdded = needsImg.length;
    await imageLoadCounter(k, _pendingAdded);

    let done = 0;
    // At most one write per second instead of one per image; that relieves
    // the pool. The counter increases BEFORE the await so that nothing reports twice.
    const flushProgress = async (force?: boolean) => {
      const delta = done - _flushed;
      if (delta <= 0) return;
      if (!force && k.uhr.jetzt() - _lastFlush < 1000) return;
      _flushed += delta;
      _lastFlush = k.uhr.jetzt();
      await imageLoadCounter(k, -delta);
    };
    await Promise.all(
      needsImg.map(async p => {
        await loadPartImage(k, p);
        done++;
        await flushProgress(false);
      }),
    );
    await flushProgress(true);
    console.log(`[img-dl] ${n}: ${done}/${needsImg.length} Bilder geladen`);
  } finally {
    // Only settle the not-yet-reported rest — covers abort without
    // subtracting twice in the normal case.
    const _rest = _pendingAdded - _flushed;
    if (_rest > 0) await imageLoadCounter(k, -_rest);
    if (lockClient) {
      if (haveXlock) await repo.giveImageLockFree(lockClient, n).catch(logAndContinue('teile-enrich:hashtext'));
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

export { downloadImage, downloadSetImages };
