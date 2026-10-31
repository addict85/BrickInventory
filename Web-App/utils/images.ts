/**
 * Bild-Helfer — zentrale Implementierung.
 * Ausführlich: docs/begruendungen/utils/images.ts.md#abschnitt
 */

import fs from 'fs';
import crypto from 'crypto';
import { APP_ROOT, IMAGES_DIR } from '../src/infra/appPaths';
import path from 'path';

// thumbFs → { exists, checkedAt }. Positive Treffer bleiben dauerhaft gültig
// (Thumbs werden nie gelöscht, nur erzeugt); negative werden nach 10 Min
// erneut geprüft, damit frisch generierte Thumbs erscheinen.
const _thumbCache = new Map();

/**
 * Die ältesten n Einträge aus einer Map entfernen (Map hält die
 * Einfügereihenfolge, der erste Schlüssel ist also der älteste).
 * @param {Map<any, any>} map
 * @param {number} n
 */
function _evictOldest(map: Map<any, any>, n: number) {
  let removed = 0;
  for (const k of map.keys()) {
    map.delete(k);
    if (++removed >= n) break;
  }
}

/**
 * Liefert den _thumb.jpg-Pfad, falls das Thumbnail existiert — sonst das
 * Original. Unterstützt /data/… (Laufzeit-Daten) und /images/… (public/).
 */
/** @param {string|null|undefined} localPath @returns {string|null|undefined} */
function resolveImageLocal(localPath: string | null | undefined) {
  if (!localPath) return localPath;
  const ext       = path.extname(localPath);
  const thumbPath = localPath.replace(ext, '_thumb.jpg');
  let thumbFs;
  if      (thumbPath.startsWith('/data/'))   thumbFs = path.join(APP_ROOT, thumbPath.slice(1));
  // /images/… liegt seit der Umstellung unter data/images/ — siehe IMAGES_DIR.
  else if (thumbPath.startsWith('/images/')) thumbFs = path.join(IMAGES_DIR, thumbPath.slice('/images/'.length));
  else return localPath;

  const hit = _thumbCache.get(thumbFs);
  if (hit && (hit.exists || Date.now() - hit.checkedAt < 10 * 60 * 1000))
    return hit.exists ? thumbPath : localPath;

  const exists = fs.existsSync(thumbFs);
  // Verdrängung statt Kahlschlag.
  //
  // VORHER: _thumbCache.clear() — der komplette Cache flog weg, sobald die
  // Grenze erreicht war. Genau danach prasselt für jede Katalogseite wieder
  // die volle Ladung existsSync-Aufrufe herein, also ausgerechnet im Moment
  // der höchsten Last. Jetzt fliegt das älteste Viertel raus; Map bewahrt die
  // Einfügereihenfolge, die ersten Schlüssel sind damit die ältesten.
  if (_thumbCache.size > 20000) _evictOldest(_thumbCache, 5000);
  _thumbCache.set(thumbFs, { exists, checkedAt: Date.now() });
  return exists ? thumbPath : localPath;
}

/**
 * Die Adresse des Bild-Proxys — an EINER Stelle.
 * Ausführlich: docs/begruendungen/utils/images.ts.md#img-proxy-pfad
 */
const IMG_PROXY_PFAD = '/api/v1/img-proxy';
/** Nur noch für Altbestand und ältere App-Fassungen — siehe oben. */
const IMG_PROXY_PFAD_ALT = '/api/img-proxy';

/** Trägt diese Adresse eine der beiden Proxy-Formen? */
function istProxyPfad(src: string): boolean {
  return src.startsWith(IMG_PROXY_PFAD) || src.startsWith(IMG_PROXY_PFAD_ALT);
}

/**
 * Externe Bild-URLs ggf. über den Server-Proxy leiten: Nur die Rebrickable-CDN
 * braucht serverseitige Header (Hotlink-Schutz); alles andere lädt direkt.
 */
/** @param {string|null|undefined} url @returns {string|null} */
function proxyImageUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  if (url.includes('rebrickable.com')) return `${IMG_PROXY_PFAD}?url=${encodeURIComponent(url)}`;
  return url;
}

// _existsCache: analog zu _thumbCache oben, aber für die Existenz der
// ORIGINAL-Datei — nötig für Aufrufer wie den Katalog, die (anders als
// sets/parts/minifigs) KEINE gespeicherte image_local-Spalte in einer
// Pro-Nutzer-Tabelle haben und die Existenz bei jeder Anfrage neu prüfen
// müssen.
const _existsCache = new Map();

/**
 * Prüft (mit Cache), ob eine lokale Bilddatei existiert, und liefert bei
 * Treffer direkt den Thumb-bevorzugten Pfad über resolveImageLocal() —
 * sonst null.
 * Ausführlich: docs/begruendungen/utils/images.ts.md#resolveifexists
 * @param {string} publicRelPath z. B. "/images/sets/10283-1.jpg"
 * @returns {string|null}
 */
function resolveIfExists(publicRelPath: string) {
  const hit = _existsCache.get(publicRelPath);
  if (hit && (hit.exists || Date.now() - hit.checkedAt < 10 * 60 * 1000))
    return hit.exists ? resolveImageLocal(publicRelPath) : null;

  const fsPath = publicRelPath.startsWith('/images/')
    ? path.join(IMAGES_DIR, publicRelPath.slice('/images/'.length))
    : path.join(APP_ROOT, publicRelPath.replace(/^\//, ''));
  const exists = fs.existsSync(fsPath);
  if (_existsCache.size > 20000) _evictOldest(_existsCache, 5000);  // siehe _thumbCache oben
  _existsCache.set(publicRelPath, { exists, checkedAt: Date.now() });
  return exists ? resolveImageLocal(publicRelPath) : null;
}

export { resolveImageLocal, proxyImageUrl, resolveIfExists,
         IMG_PROXY_PFAD, IMG_PROXY_PFAD_ALT, istProxyPfad };

/**
 * Wo läge das Bild dieser CDN-Adresse im Proxy-Cache?
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#proxycachepathfor
 */
export function proxyCachePathFor(url: string): string | null {
  if (!url) return null;
  return path.join(APP_ROOT, 'data', 'img_proxy_cache',
    crypto.createHash('sha1').update(url).digest('hex'));
}
