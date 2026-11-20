import { reportError } from '../infra/error';
import { ereignis } from '../infra/event';
import { Zwischenspeicher } from '../infra/cache';
import type { ImagesContext } from './context';

/** Data, not a queue: one row per address. Processed by the ONE
 * job 'bildbedarf', which fetches in batches with consideration for the CDN. */

/** Ten images per pass, every 20 seconds: thirty requests per minute. */
export const STAPEL = 10;
export const TAKT_MS = 20_000;
/** What nobody has looked at for days is not urgent. */
export const NOTIZ_GILT_MS = 3 * 24 * 60 * 60 * 1000;
export const IMAGE_DEMAND_KEY = 'bildbedarf';

export function requestsJeMinute(): number {
  return STAPEL * (60_000 / TAKT_MS);
}

const setBildGeladen = (k: ImagesContext) =>
  k.faecher.fach('setBildGeladen', () => ereignis<[setNummer: string, quelle: string | null]>('setBildGeladen'));
/** The entry on the set is made by the catalog (higher); it listens here instead of the images calling it. */
export function atSetImageLoaded(k: ImagesContext, fn: (setNummer: string, quelle: string | null) => unknown) {
  return setBildGeladen(k).horche(fn);
}

/** @returns false if a listener failed (it is logged) */
export function reportSetImageLoaded(k: ImagesContext, setNummer: string, quelle: string | null = null) {
  return setBildGeladen(k).melde(setNummer, quelle);
}

/** If one is already open, it stays at one. */
export async function imageDemandKick(k: ImagesContext): Promise<void> {
  await k.jobQueue.placeJobOne('bildbedarf', {}, { schluessel: IMAGE_DEMAND_KEY, maxAttempts: 3 });
}

/** One INSERT per image request drained the pool with a tile wall. Whatever is in the buffer
 * during a crash is requested again by the next call. */
const puffer = (k: ImagesContext) => k.faecher.fach('bildbedarf:puffer', () => new Map<string, string>()); // url → set_number
const takte = (k: ImagesContext) => k.faecher.fach('bildbedarf:takte', (): NodeJS.Timeout[] => []);

/** Once per set in 15 minutes, at most 5000 remembered: the image proxy asks for every
 * tile, and an account with invented numbers would otherwise fill the notes. */
export function imageOnceReserve(k: ImagesContext, url: string, setNummer: string): void {
  const gemerkt = k.faecher.fach('bildbedarf:vorgemerkt', () => new Zwischenspeicher<string, true>(5000, 15 * 60_000));
  if (gemerkt.hole(setNummer)) return;
  gemerkt.setze(setNummer, true);
  rememberUsed(k, url, setNummer);
}

/** Never holds up the request. */
export function rememberUsed(k: ImagesContext, url: string, setNumber: string | null): void {
  if (!setNumber) return;
  if (puffer(k).size < 500) puffer(k).set(url, setNumber);
}

export async function noteImageDemand(k: ImagesContext, urls: string[], sets: (string | null)[]): Promise<void> {
  await k.bildbedarf.rememberImageRequests(urls, sets);
}

/** Written via the context of whoever started the tick (setUpImageDemand). */
export async function schreibePuffer(k: ImagesContext): Promise<void> {
  const _puffer = puffer(k);
  if (!_puffer.size) return;
  const urls = [..._puffer.keys()];
  const sets = urls.map(u => _puffer.get(u)!);
  _puffer.clear();
  // If writing fails, the buffer goes back and the error to the tick: nothing gets lost.
  try {
    await noteImageDemand(k, urls, sets);
  } catch (e) {
    for (const [i, u] of urls.entries()) _puffer.set(u, sets[i]!);
    throw e;
  }
  await imageDemandKick(k);
}

export async function setUpImageDemand(k: ImagesContext): Promise<void> {
  const _ticks = takte(k);
  if (_ticks.length) return;
  _ticks.push(
    setInterval(() => {
      schreibePuffer(k).catch(e => reportError('bild-job:schreibePuffer', e));
    }, 10_000),
  );
  _ticks[0]?.unref();
}

/** Before closing the pool: whatever is in the buffer still needs a connection. */
export async function stopImageDemand(k: ImagesContext): Promise<void> {
  for (const t of takte(k).splice(0)) clearInterval(t);
  await schreibePuffer(k);
}

// Otherwise old notes remain.
export async function deleteExpired(k: ImagesContext): Promise<number> {
  const r = await k.bildbedarf.deleteOldImageRequests(String(NOTIZ_GILT_MS));
  return r?.changes || 0;
}

/** Reserve catalog images for the image demand; returns how many were newly added. */
export async function catalogImagesReserve(k: ImagesContext, urls: string[], sets: string[]): Promise<number> {
  return (await k.bildbedarf.seriesCatalogImagesOne(urls, sets))?.n ?? 0;
}

export async function openImageDemand(k: ImagesContext): Promise<number> {
  return (await k.bildbedarf.countImageRequests())?.n ?? 0;
}

export async function emptyImageDemand(k: ImagesContext): Promise<number> {
  return (await k.bildbedarf.deleteAllImageRequests())?.changes ?? 0;
}

/** Taken out in one step so that two runs do not fetch the same images. */
export function nimmBildwuensche(
  k: ImagesContext,
  validMs: number,
  anzahl: number,
): Promise<{ url: string; set_number: string | null }[]> {
  return k.bildbedarf.entnimmBildwuensche(String(validMs), anzahl);
}
