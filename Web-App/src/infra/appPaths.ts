/** Paths in one place: __dirname points to a different location from dist/ than
 * from the sources. */
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config';

function findRoot(): string {
  const root = config().appRoot;
  if (root) return path.resolve(root);
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels above this file (src/infra/ → root).
  return path.resolve(__dirname, '..', '..');
}

export const APP_ROOT = findRoot();

/** Mounted volume: images, uploads, instructions, caches. */
export const DATA_DIR = path.join(APP_ROOT, 'data');

/** In the image from the build stage, read-only. */
export const PUBLIC_DIR = path.join(APP_ROOT, 'public');

/** In the volume, not under public/: the image is read-only and gets replaced on
 * update. */
export const IMAGES_DIR = path.join(DATA_DIR, 'images');

// Images separated by kind.
export const SET_IMAGES_DIR = path.join(IMAGES_DIR, 'sets');
export const PART_IMAGES_DIR = path.join(IMAGES_DIR, 'parts');
export const MINIFIG_IMAGES_DIR = path.join(IMAGES_DIR, 'minifigs');

// Shared instructions; own ones in uploads/.
export const INSTRUCTIONS_DIR = path.join(DATA_DIR, 'instructions');
export const PDF_JOB_DIR = path.join(DATA_DIR, 'pdf-jobs');

/** null for everything else — the caller decides what that means. */
export function resolveWebPath(webPath: string): string | null {
  if (!webPath) return null;
  if (webPath.startsWith('/data/')) return path.join(APP_ROOT, webPath.slice(1));
  if (webPath.startsWith('/images/')) return path.join(IMAGES_DIR, webPath.slice('/images/'.length));
  return null;
}
