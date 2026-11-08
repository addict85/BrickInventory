/** Pfade an einer Stelle: __dirname zeigt aus dist/ an einen anderen Ort als
 * aus den Quellen. */
import path from 'path';
import fs from 'fs';
import { konfig } from './konfig';

function findRoot(): string {
  const wurzel = konfig().appRoot;
  if (wurzel) return path.resolve(wurzel);
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Rückfallebene: zwei Ebenen über dieser Datei (src/infra/ → Wurzel).
  return path.resolve(__dirname, '..', '..');
}

export const APP_ROOT = findRoot();

/** Gemountetes Volume: Bilder, Uploads, Anleitungen, Caches. */
export const DATA_DIR = path.join(APP_ROOT, 'data');

/** Im Image aus dem Build-Stage, read-only. */
export const PUBLIC_DIR = path.join(APP_ROOT, 'public');

/** Im Volume, nicht unter public/: Das Image ist read-only und wird beim
 * Update ersetzt. Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#images-dir */
export const IMAGES_DIR = path.join(DATA_DIR, 'images');

// Bilder nach Art getrennt. Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#set-images-dir
export const SET_IMAGES_DIR     = path.join(IMAGES_DIR, 'sets');
export const PART_IMAGES_DIR    = path.join(IMAGES_DIR, 'parts');
export const MINIFIG_IMAGES_DIR = path.join(IMAGES_DIR, 'minifigs');

// Geteilte Anleitungen; eigene in uploads/. Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#instructions-dir
export const INSTRUCTIONS_DIR = path.join(DATA_DIR, 'instructions');
export const PDF_JOB_DIR = path.join(DATA_DIR, 'pdf-jobs');

/** null für alles andere — der Aufrufer entscheidet, was das heisst. */
export function resolveWebPath(webPath: string): string | null {
  if (!webPath) return null;
  if (webPath.startsWith('/data/'))   return path.join(APP_ROOT, webPath.slice(1));
  if (webPath.startsWith('/images/')) return path.join(IMAGES_DIR, webPath.slice('/images/'.length));
  return null;
}

