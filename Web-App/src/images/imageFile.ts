/** Whatever lies under /images/ comes from the own origin — an SVG or
 * HTML file would run with the app's rights. That is why the foreign
 * address alone never determines file name, extension or target. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { AbrufFehler } from '../infra/fetch';
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
export function imageExtension(adresse: string): string {
  let pfad = '';
  try {
    pfad = new URL(adresse).pathname;
  } catch {
    return 'jpg';
  }
  const e = (pfad.split('.').pop() ?? '').toLowerCase();
  return Object.hasOwn(EXTENSION_TO_TYPE, e) ? e : 'jpg';
}

export function imageTypeAllowed(contentType: string | undefined): boolean {
  const typ =
    String(contentType ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase() ?? '';
  return Object.values(EXTENSION_TO_TYPE).includes(typ);
}

/** @returns null if it could form a path — then nothing is saved */
export function filePart(wert: unknown): string | null {
  const s = String(wert ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) && !s.includes('..') ? s : null;
}

/** Only if it really lies directly in the folder. */
export function targetInFolder(ordner: string, datei: string): string | null {
  const ziel = path.resolve(ordner, datei);
  return path.dirname(ziel) === path.resolve(ordner) ? ziel : null;
}

/** First into a temporary file, so that an aborted download does not later
 * count as "already present".
 * @returns whether the image now lies under `ziel` */
export async function loadImage(
  k: ImagesContext,
  adresse: string,
  ziel: string,
  allowedHosts: readonly string[],
  kopfzeilen: Record<string, string> = {},
  reportWarning: (text: string) => void = () => {},
): Promise<boolean> {
  let a: Awaited<ReturnType<ImagesContext['externalSources']['quellen']['oeffneBild']>>;
  try {
    a = await k.externalSources.quellen.oeffneBild(adresse, {
      hosts: allowedHosts,
      maxBytes: IMAGE_MAX_BYTES,
      zeitlimitMs: 30_000,
      kopfzeilen,
    });
  } catch (e) {
    reportWarning(e instanceof Error ? e.message : String(e));
    return false;
  }
  if (a.status !== 200) {
    a.verwerfen();
    reportWarning(`HTTP ${a.status}: ${adresse.slice(0, 80)}`);
    return false;
  }
  if (!imageTypeAllowed(a.kopf['content-type'])) {
    a.verwerfen();
    reportWarning(`kein Bild (${a.kopf['content-type']}): ${adresse.slice(0, 80)}`);
    return false;
  }
  // Unique per fetch: two concurrent downloads would otherwise write into
  // the same temporary file.
  const zwischen = `${ziel}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.teil`;
  try {
    await pipeline(a.strom(), fs.createWriteStream(zwischen));
    await fs.promises.rename(zwischen, ziel);
    return true;
  } catch (e) {
    if (e instanceof AbrufFehler && e.grund === 'zu-gross') reportWarning(`Bild zu gross: ${adresse.slice(0, 80)}`);
    await fs.promises.rm(zwischen, { force: true });
    return false;
  }
}
