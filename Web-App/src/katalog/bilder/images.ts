// Ausführlich: docs/begruendungen/src/katalog/bilder/images.ts.md#abschnitt

import fs from 'fs';
import crypto from 'crypto';
import { APP_ROOT, IMAGES_DIR } from '../../infra/appPaths';
import path from 'path';

// Positive Treffer bleiben gültig (Vorschauen werden nie gelöscht); negative
// nach 10 Min neu prüfen, damit frisch erzeugte erscheinen.
const _thumbCache = new Map();

/** Map hält die Einfügereihenfolge: Der erste Schlüssel ist der älteste. */
function _evictOldest(map: Map<unknown, unknown>, n: number) {
  let removed = 0;
  for (const k of map.keys()) {
    map.delete(k);
    if (++removed >= n) break;
  }
}

export function resolveImageLocal(localPath: string | null | undefined) {
  if (!localPath) return localPath;
  const ext       = path.extname(localPath);
  const thumbPath = localPath.replace(ext, '_thumb.jpg');
  let thumbFs;
  if      (thumbPath.startsWith('/data/'))   thumbFs = path.join(APP_ROOT, thumbPath.slice(1));
  else if (thumbPath.startsWith('/images/')) thumbFs = path.join(IMAGES_DIR, thumbPath.slice('/images/'.length));
  else return localPath;

  const hit = _thumbCache.get(thumbFs);
  if (hit && (hit.exists || Date.now() - hit.checkedAt < 10 * 60 * 1000))
    return hit.exists ? thumbPath : localPath;

  const exists = fs.existsSync(thumbFs);
  // Das älteste Viertel verdrängen statt alles zu leeren: Danach käme die volle
  // Ladung existsSync ausgerechnet im Moment der höchsten Last.
  if (_thumbCache.size > 20000) _evictOldest(_thumbCache, 5000);
  _thumbCache.set(thumbFs, { exists, checkedAt: Date.now() });
  return exists ? thumbPath : localPath;
}

// Ausführlich: docs/begruendungen/src/katalog/bilder/images.ts.md#img-proxy-pfad
export const IMG_PROXY_PFAD = '/api/v1/img-proxy';
/** Nur noch für Altbestand und ältere App-Fassungen. */
export const IMG_PROXY_PFAD_ALT = '/api/img-proxy';

export function istProxyPfad(src: string): boolean {
  return src.startsWith(IMG_PROXY_PFAD) || src.startsWith(IMG_PROXY_PFAD_ALT);
}

/** Nur Bilder von Rebrickable gehen über den Proxy; ein Teilstring passte auch auf fremde Hosts. */
function istRebrickableBild(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'rebrickable.com' || h.endsWith('.rebrickable.com');
  } catch { return false; }
}

export function proxyImageUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  if (istRebrickableBild(url)) return `${IMG_PROXY_PFAD}?url=${encodeURIComponent(url)}`;
  return url;
}

// Für Aufrufer ohne gespeicherte image_local-Spalte (Katalog), die die
// Existenz sonst bei jeder Anfrage neu prüften.
const _existsCache = new Map();

/** Liefert bei Treffer den Vorschau-bevorzugten Pfad, sonst null.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/images.ts.md#resolveifexists
 * @param publicRelPath z. B. "/images/sets/10283-1.jpg" */
export function resolveIfExists(publicRelPath: string) {
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

/** Diese CDNs liefern dasselbe Bild ohne Anfrageteil; dort steht nur ein
 * Zeitstempel. Mit ihm im Schlüssel legte jede Variante eine neue Datei an.
 * www.bricklink.com braucht ihn (getPic.asp?…), dort wird er nur sortiert. */
const OHNE_ANFRAGETEIL = ['cdn.rebrickable.com', 'images.brickset.com', 'img.bricklink.com'];

/** Die Adresse, die der Proxy holt und nach der er ablegt; null, wenn unlesbar. */
export function proxyAdresse(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  u.hash = '';
  if (OHNE_ANFRAGETEIL.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) u.search = '';
  else u.searchParams.sort();
  return u.href;
}

export function proxyCacheSchluessel(url: string): string {
  return crypto.createHash('sha1').update(proxyAdresse(url) ?? url).digest('hex');
}

// Ausführlich: docs/begruendungen/src/katalog/bilder/images.ts.md#proxycachepathfor
export function proxyCachePathFor(url: string): string | null {
  if (!url) return null;
  return path.join(APP_ROOT, 'data', 'img_proxy_cache', proxyCacheSchluessel(url));
}
