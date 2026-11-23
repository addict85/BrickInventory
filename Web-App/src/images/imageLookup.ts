import { Cache } from '../infra/cache';
import type { ImagesContext } from './context';

/** Redirecting to the CDN address heals web and app without having to clean up orphaned
 * image_local entries. Looked up via the indexed
 * file name stem (image_master()). */
const CACHE_MS = 10 * 60 * 1000;
const cdnStorage = (k: ImagesContext) =>
  k.compartments.slot('cdnZuPfad', () => new Cache<string, { url: string | null }>(5000, CACHE_MS));

export function imageMasterFromPath(webPath: string): string {
  const file = webPath.split('/').pop() || '';
  return file.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
}

export async function cdnForMissingImage(k: ImagesContext, webPath: string): Promise<string | null> {
  const remembered = cdnStorage(k).hole(webPath);
  if (remembered) return remembered.url;
  const master = imageMasterFromPath(webPath);
  let url: string | null = null;
  if (master) {
    const z = await k.imageMasterCdn.cdnToImageMaster(master);
    url = z?.url ?? null;
  }
  cdnStorage(k).set(webPath, { url });
  return url;
}

/** For tests, so that the query's plan can be checked. */
export { CDN_QUERY } from './repository/imageMasterCdn';
