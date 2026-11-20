import { Zwischenspeicher } from '../infra/cache';
import type { ImagesContext } from './context';

/** Redirecting to the CDN address heals web and app without having to clean up orphaned
 * image_local entries. Looked up via the indexed
 * file name stem (bild_stamm()). */
const CACHE_MS = 10 * 60 * 1000;
const cdnStorage = (k: ImagesContext) =>
  k.faecher.fach('cdnZuPfad', () => new Zwischenspeicher<string, { url: string | null }>(5000, CACHE_MS));

export function imageMasterFromPath(webPath: string): string {
  const datei = webPath.split('/').pop() || '';
  return datei.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
}

export async function cdnForMissingImage(k: ImagesContext, webPath: string): Promise<string | null> {
  const gemerkt = cdnStorage(k).hole(webPath);
  if (gemerkt) return gemerkt.url;
  const stamm = imageMasterFromPath(webPath);
  let url: string | null = null;
  if (stamm) {
    const z = await k.bildStammCdn.cdnZuBildstamm(stamm);
    url = z?.url ?? null;
  }
  cdnStorage(k).setze(webPath, { url });
  return url;
}

/** For tests, so that the query's plan can be checked. */
export { CDN_QUERY } from './repository/imageMasterCdn';
