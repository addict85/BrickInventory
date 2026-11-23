import { reportError } from '../infra/error';
import { event } from '../infra/event';
import { Cache } from '../infra/cache';
import type { ImagesContext } from './context';

/** Data, not a queue: one row per address. Processed by the ONE
 * job 'image_demand', which fetches in batches with consideration for the CDN. */

/** Ten images per pass, every 20 seconds: thirty requests per minute. */
export const BATCH = 10;
export const TICK_MS = 20_000;
/** What nobody has looked at for days is not urgent. */
export const NOTE_VALID_MS = 3 * 24 * 60 * 60 * 1000;
export const IMAGE_DEMAND_KEY = 'image_demand';

export function requestsPerMinute(): number {
  return BATCH * (60_000 / TICK_MS);
}

const setImageLoaded = (k: ImagesContext) =>
  k.compartments.slot('setBildGeladen', () => event<[setNumber: string, source: string | null]>('setBildGeladen'));
/** The entry on the set is made by the catalog (higher); it listens here instead of the images calling it. */
export function atSetImageLoaded(k: ImagesContext, fn: (setNumber: string, source: string | null) => unknown) {
  return setImageLoaded(k).listen(fn);
}

/** @returns false if a listener failed (it is logged) */
export function reportSetImageLoaded(k: ImagesContext, setNumber: string, source: string | null = null) {
  return setImageLoaded(k).report(setNumber, source);
}

/** If one is already open, it stays at one. */
export async function imageDemandKick(k: ImagesContext): Promise<void> {
  await k.jobQueue.placeJobOne('image_demand', {}, { key: IMAGE_DEMAND_KEY, maxAttempts: 3 });
}

/** One INSERT per image request drained the pool with a tile wall. Whatever is in the buffer
 * during a crash is requested again by the next call. */
const buffer = (k: ImagesContext) => k.compartments.slot('image_demand:puffer', () => new Map<string, string>()); // url → set_number
const ticks = (k: ImagesContext) => k.compartments.slot('image_demand:takte', (): NodeJS.Timeout[] => []);

/** Once per set in 15 minutes, at most 5000 remembered: the image proxy asks for every
 * tile, and an account with invented numbers would otherwise fill the notes. */
export function imageOnceReserve(k: ImagesContext, url: string, setNumber: string): void {
  const remembered = k.compartments.slot('image_demand:vorgemerkt', () => new Cache<string, true>(5000, 15 * 60_000));
  if (remembered.hole(setNumber)) return;
  remembered.set(setNumber, true);
  rememberUsed(k, url, setNumber);
}

/** Never holds up the request. */
export function rememberUsed(k: ImagesContext, url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (buffer(k).size < 500) buffer(k).set(url, setNumber);
}

export async function noteImageDemand(k: ImagesContext, urls: string[], sets: (string | null)[]): Promise<void> {
  await k.imageDemand.rememberImageRequests(urls, sets);
}

/** Written via the context of whoever started the tick (setUpImageDemand). */
export async function writeBuffer(k: ImagesContext): Promise<void> {
  const _buffer = buffer(k);
  if (!_buffer.size) return;
  const urls = [..._buffer.keys()];
  const sets = urls.map(u => _buffer.get(u)!);
  _buffer.clear();
  // If writing fails, the buffer goes back and the error to the tick: nothing gets lost.
  try {
    await noteImageDemand(k, urls, sets);
  } catch (e) {
    for (const [i, u] of urls.entries()) _buffer.set(u, sets[i]!);
    throw e;
  }
  await imageDemandKick(k);
}

export async function setUpImageDemand(k: ImagesContext): Promise<void> {
  const _ticks = ticks(k);
  if (_ticks.length) return;
  _ticks.push(
    setInterval(() => {
      writeBuffer(k).catch(e => reportError('bild-job:schreibePuffer', e));
    }, 10_000),
  );
  _ticks[0]?.unref();
}

/** Before closing the pool: whatever is in the buffer still needs a connection. */
export async function stopImageDemand(k: ImagesContext): Promise<void> {
  for (const t of ticks(k).splice(0)) clearInterval(t);
  await writeBuffer(k);
}

// Otherwise old notes remain.
export async function deleteExpired(k: ImagesContext): Promise<number> {
  const r = await k.imageDemand.deleteOldImageRequests(String(NOTE_VALID_MS));
  return r?.changes || 0;
}

/** Reserve catalog images for the image demand; returns how many were newly added. */
export async function catalogImagesReserve(k: ImagesContext, urls: string[], sets: string[]): Promise<number> {
  return (await k.imageDemand.seriesCatalogImagesOne(urls, sets))?.n ?? 0;
}

export async function openImageDemand(k: ImagesContext): Promise<number> {
  return (await k.imageDemand.countImageRequests())?.n ?? 0;
}

export async function emptyImageDemand(k: ImagesContext): Promise<number> {
  return (await k.imageDemand.deleteAllImageRequests())?.changes ?? 0;
}

/** Taken out in one step so that two runs do not fetch the same images. */
export function takeImageRequests(
  k: ImagesContext,
  validMs: number,
  count: number,
): Promise<{ url: string; set_number: string | null }[]> {
  return k.imageDemand.takeImageRequests(String(validMs), count);
}
