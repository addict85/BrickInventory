/** Whatever lies under /images/ comes from the own origin — an SVG or
 * HTML file would run with the app's rights. That is why the foreign
 * address alone never determines file name, extension or target. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { FetchError } from '../infra/fetch';
import type { ImagesContext } from './context';

/** Deliberately without SVG. */
const EXTENSION_TO_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Otherwise jpg. */
export function imageExtension(address: string): string {
  let path = '';
  try {
    path = new URL(address).pathname;
  } catch {
    return 'jpg';
  }
  const e = (path.split('.').pop() ?? '').toLowerCase();
  return Object.hasOwn(EXTENSION_TO_TYPE, e) ? e : 'jpg';
}

export function imageTypeAllowed(contentType: string | undefined): boolean {
  const type =
    String(contentType ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase() ?? '';
  return Object.values(EXTENSION_TO_TYPE).includes(type);
}

/** @returns null if it could form a path — then nothing is saved */
export function filePart(value: unknown): string | null {
  const s = String(value ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !s.includes('..') ? s : null;
}

/** Only if it really lies directly in the folder. */
export function targetInFolder(folder: string, file: string): string | null {
  const target = path.resolve(folder, file);
  return path.dirname(target) === path.resolve(folder) ? target : null;
}

/** First into a temporary file, so that an aborted download does not later
 * count as "already present".
 * @returns whether the image now lies under `ziel` */
export async function loadImage(
  k: ImagesContext,
  address: string,
  target: string,
  allowedHosts: readonly string[],
  headers: Record<string, string> = {},
  reportWarning: (text: string) => void = () => {},
): Promise<boolean> {
  let a: Awaited<ReturnType<ImagesContext['externalSources']['sources']['openImage']>>;
  try {
    a = await k.externalSources.sources.openImage(address, {
      hosts: allowedHosts,
      maxBytes: IMAGE_MAX_BYTES,
      timeoutMs: 30_000,
      headers,
    });
  } catch (e) {
    reportWarning(e instanceof Error ? e.message : String(e));
    return false;
  }
  if (a.status !== 200) {
    a.discard();
    reportWarning(`HTTP ${a.status}: ${address.slice(0, 80)}`);
    return false;
  }
  if (!imageTypeAllowed(a.head['content-type'])) {
    a.discard();
    reportWarning(`kein Bild (${a.head['content-type']}): ${address.slice(0, 80)}`);
    return false;
  }
  // Unique per fetch: two concurrent downloads would otherwise write into
  // the same temporary file.
  const between = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.teil`;
  try {
    await pipeline(a.stream(), fs.createWriteStream(between));
    await fs.promises.rename(between, target);
    return true;
  } catch (e) {
    if (e instanceof FetchError && e.reason === 'zu-gross') reportWarning(`Bild zu gross: ${address.slice(0, 80)}`);
    await fs.promises.rm(between, { force: true });
    return false;
  }
}
