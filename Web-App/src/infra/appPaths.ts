/**
 * Zentrale Auflösung der Anwendungspfade.
 * Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#abschnitt
 */
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

/** Wurzelverzeichnis der Anwendung (enthält package.json, data/, public/). */
const APP_ROOT = findRoot();

/** Laufzeitdaten — gemountetes Volume. Bilder, Uploads, Anleitungen, Caches. */
const DATA_DIR = path.join(APP_ROOT, 'data');

/** Ausgelieferte Frontend-Dateien. Im Image aus dem Build-Stage, read-only. */
const PUBLIC_DIR = path.join(APP_ROOT, 'public');

/**
 * Heruntergeladene Set-, Teile- und Minifiguren-Bilder.
 * Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#images-dir
 */
const IMAGES_DIR = path.join(DATA_DIR, 'images');

/**
 * Bilder nach Art getrennt.
 * Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#set-images-dir
 */
const SET_IMAGES_DIR     = path.join(IMAGES_DIR, 'sets');
const PART_IMAGES_DIR    = path.join(IMAGES_DIR, 'parts');
const MINIFIG_IMAGES_DIR = path.join(IMAGES_DIR, 'minifigs');

/**
 * Geteilte Bauanleitungen (PDFs).
 * Ausführlich: docs/begruendungen/src/infra/appPaths.ts.md#instructions-dir
 */
const INSTRUCTIONS_DIR = path.join(DATA_DIR, 'instructions');
/** Aufträge und Ergebnisse der PDF-Erzeugung. */
const PDF_JOB_DIR = path.join(DATA_DIR, 'pdf-jobs');

/**
 * Web-Pfad ("/data/…" oder "/images/…") in einen Dateisystempfad übersetzen.
 * Liefert null für alles andere — der Aufrufer entscheidet, was das heisst.
 *
 * @param {string} webPath z. B. "/data/part_images/3001_4.png"
 * @returns {string|null}
 */
function resolveWebPath(webPath: string): string | null {
  if (!webPath) return null;
  if (webPath.startsWith('/data/'))   return path.join(APP_ROOT, webPath.slice(1));
  // "/images/sets/x.jpg" → <data>/images/sets/x.jpg (siehe IMAGES_DIR oben).
  if (webPath.startsWith('/images/')) return path.join(IMAGES_DIR, webPath.slice('/images/'.length));
  return null;
}


export {
  APP_ROOT, DATA_DIR, PUBLIC_DIR, IMAGES_DIR,
  SET_IMAGES_DIR, PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, INSTRUCTIONS_DIR, PDF_JOB_DIR,
  resolveWebPath,
};
