import type { AppConfig } from '../infra/config';
import path from 'node:path';
import fs from 'node:fs';
import { FetchError } from '../infra/fetch';
import { IMAGE_HEADERS } from '../externalSources';
import type { ImagesContext } from './context';

/** What the image works need; it is created before the area's context (area.ts). */
export type ImageWorkerContext = Pick<ImagesContext, 'config' | 'externalSources'>;
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { withVersion } from '../infra/setNumber';

// Fetch set images from the CDN; here instead of in the router so that callers import properly.

// As in the image proxy; with 5 MB large set images would stay without a local file.
export const SET_IMG_MAX_BYTES = 20 * 1024 * 1024;

/** The same browser identifier as the image proxy: the CDN rejects an own one with 403,
 * and the image job would then pause endlessly. IMG_USER_AGENT stays as a way out. */
export function imageUserAgent(k: Pick<AppConfig, 'imageUserAgent'>): string {
  return k.imageUserAgent || String(IMAGE_HEADERS['User-Agent']);
}

/** Only Rebrickable images are stored by the proxy including preview under images/sets. */
export function rebrickableSetImage(setNumber: string): string {
  return `https://cdn.rebrickable.com/media/sets/${encodeURIComponent(withVersion(setNumber))}.jpg`;
}

/** If image and preview already lie in images/sets, the image job needs nothing more. */
export async function setImageComplete(setNumber: string): Promise<boolean> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  const da = (file: string) =>
    fs.promises.access(path.join(SET_IMAGES_DIR, file)).then(
      () => true,
      () => false,
    );
  return (await da(`${safe}.jpg`)) && (await da(`${safe}_thumb.jpg`));
}

export async function downloadSetImage(
  k: ImageWorkerContext,
  url: string,
  setNumber: string,
  info?: { status?: number },
) {
  const userAgent = imageUserAgent(k.config);
  if (!url) return null;
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  const localPath = path.join(SET_IMAGES_DIR, `${safe}.jpg`);
  const relPath = `/images/sets/${safe}.jpg`;
  if (
    await fs.promises.access(localPath).then(
      () => true,
      () => false,
    )
  )
    return relPath;
  const buf = await k.externalSources.sources
    .fetchImage(url, {
      maxBytes: SET_IMG_MAX_BYTES,
      timeoutMs: 30_000,
      headers: { ...IMAGE_HEADERS, 'User-Agent': userAgent },
    })
    .then(
      r => {
        if (r.status === 200) return r.body;
        // "404" and "403 bot detection" require different measures; without
        // a real code it counts as temporary in src/images/imageDemandRun.ts.
        const notPresent = r.status === 404 || r.status === 410;
        (notPresent ? console.warn : console.error)(`[set-img] ${setNumber}: HTTP ${r.status} vom Bildserver: ${url}`);
        if (info && r.status) info.status = r.status;
        return null;
      },
      (e: unknown) => {
        if (e instanceof FetchError && e.reason === 'zu-gross')
          console.error(
            `[set-img] ${setNumber}: Bild grösser als ${Math.round(SET_IMG_MAX_BYTES / 1024 / 1024)} MB — nicht lokal gespeichert: ${url}`,
          );
        else
          console.error(`[set-img] ${setNumber}: Abruf fehlgeschlagen (${e instanceof Error ? e.message : e}): ${url}`);
        return null;
      },
    );
  if (!buf) return null; // reason was already named above
  if (buf.length < 100) {
    // Too small for an image — almost always an error page.
    console.error(`[set-img] ${setNumber}: Antwort zu klein (${buf.length} Bytes) — kein Bild: ${url}`);
    return null;
  }
  // Finished first, then visible: the image proxy would otherwise deliver half a file.
  const part = `${localPath}.${process.pid}.teil`;
  // On a fresh installation the folder is still missing.
  await fs.promises.mkdir(SET_IMAGES_DIR, { recursive: true });
  await fs.promises.writeFile(part, buf);
  await fs.promises.rename(part, localPath);
  return relPath;
}
