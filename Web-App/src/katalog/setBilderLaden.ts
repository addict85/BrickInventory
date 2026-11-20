/** Bilder eines Sets laden: Teile und Figuren aus dem CDN in den eigenen Ordner,
 * unter einer Sperre je Set, die auch andere Prozesse sehen. */
import { reportError, logAndContinue } from '../infra/fehler';
import { withVersion } from '../infra/setNummer';
import { setPartImageLocal, setMinifigImageLocal } from './katalogPflege';
import { IMAGE_HEADERS } from '../fremdquellen';

// Teile- und Figurenbilder liegen in getrennten Ordnern; downloadImage()
// bekommt deshalb die Art mit.
import { imageExtension, filePart, targetInFolder } from '../bilder';
import { ALLOWED_IMAGE_HOSTS } from '../infra/fremdeAdressen';
import * as repo from './repository/teileAnreicherung';
import fs from 'node:fs';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR } from '../infra/appPaths';
import type { CatalogContext } from './kontext';

/** Wie viele Bilder gerade noch zu laden sind; die Verwaltung zeigt es in der Kachel. */
export const IMAGE_LOAD_COUNTER = 'imgdl_pending_count';
async function imageLoadCounter(k: CatalogContext, delta: number): Promise<void> {
  const d = Math.round(Number(delta) || 0);
  if (d) await k.auftraege.countState(IMAGE_LOAD_COUNTER, d).catch(logAndContinue('teile-enrich:imgDlAdd'));
}

/** @param kind Bestimmt Zielverzeichnis und Web-Pfad. */
async function downloadImage(
  k: CatalogContext,
  imgUrl: string | null | undefined,
  partNum: string,
  colorId: number,
  kind: 'part' | 'minifig',
): Promise<string | null> {
  if (!imgUrl) return null;
  const IMG_DIR = kind === 'minifig' ? MINIFIG_IMAGES_DIR : PART_IMAGES_DIR;
  const webBase = kind === 'minifig' ? '/images/minifigs/' : '/images/parts/';
  // Nummer und Adresse kommen bei manuellen Teilen vom Nutzer: Sie dürfen weder
  // einen Pfad bilden noch die Endung bestimmen.
  const nummer = filePart(partNum),
    farbe = filePart(colorId);
  if (!nummer || !farbe) return null;
  const file = `${nummer}_${farbe}.${imageExtension(imgUrl)}`;
  const dest = targetInFolder(IMG_DIR, file);
  if (!dest) return null;
  const rel = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!(await k.bilder.loadImage(imgUrl, dest, ALLOWED_IMAGE_HOSTS, IMAGE_HEADERS))) return null;
  try {
    await k.bilder.createPreview(rel).catch(logAndContinue('teile-enrich:vorschauErzeugenAus'));
  } catch (e) {
    reportError('teile-enrich:vorschau', e);
  }
  return rel;
}

/** Ein Bild vom CDN in den Teile-Ordner, dann in den Katalog. */
async function loadPartImage(k: CatalogContext, p: repo.ImageRequest): Promise<void> {
  const rawUrl = p.image_url || '';
  let cdnUrl = rawUrl;
  // Beide Schreibweisen: Altzeilen tragen noch /api/img-proxy.
  const m = rawUrl.match(/\/api\/(?:v1\/)?img-proxy\?url=(.+)/);
  if (m) cdnUrl = decodeURIComponent(m[1] ?? '');
  if (!cdnUrl.startsWith('http')) {
    console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
    return;
  }

  const nummer = filePart(p.id),
    farbe = filePart(p.color_id);
  if (!nummer || (p.kind !== 'fig' && !farbe)) {
    console.warn(`[img-dl] skipping unsafe number ${String(p.id).substring(0, 40)}`);
    return;
  }
  const file =
    p.kind === 'fig' ? `${nummer}.${imageExtension(cdnUrl)}` : `${nummer}_${farbe}.${imageExtension(cdnUrl)}`;
  const dest = targetInFolder(PART_IMAGES_DIR, file);
  if (!dest) return;
  const rel = `/images/parts/${file}`;

  if (!fs.existsSync(dest)) {
    await k.cdnDrossel.acquire();
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    const ok = await k.bilder
      .loadImage(cdnUrl, dest, ALLOWED_IMAGE_HOSTS, IMAGE_HEADERS, text =>
        console.warn(`[img-dl] ${p.id}: ${text}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')),
      )
      .finally(() => k.cdnDrossel.release());
    if (!ok) return;
  }

  // Ein Schreibfehler bricht den Lauf ab, statt eine Datei ohne Verweis zu hinterlassen;
  // der nächste Lauf findet die Datei und schreibt nur den Verweis nach.
  if (p.kind === 'fig') await setMinifigImageLocal(k, p.id, rel);
  else await setPartImageLocal(k, p.id, p.color_id, rel);
}

/** Prozessübergreifend auf einer EIGENEN Verbindung: Ein Advisory-Lock hängt an
 * der Session, über den Pool würde er unzuverlässig freigegeben. waitIfBusy (PDF)
 * wartet auf den anderen Prozess, sonst fehlten Bilder im PDF. */
async function fetchImageLock(
  k: CatalogContext,
  n: string,
  waitIfBusy: boolean,
): Promise<'belegt' | { lockClient: import('pg').PoolClient | null; haveXlock: boolean }> {
  let lockClient: import('pg').PoolClient | null = null,
    haveXlock = false;
  try {
    lockClient = await k.teileAnreicherung.lockConnection();
  } catch (_) {
    lockClient = null;
  }
  if (!lockClient) return { lockClient, haveXlock };
  const deadline = k.uhr.jetzt() + 180000; // max. 3 Min auf anderen Worker warten
  while (true) {
    try {
      haveXlock = await repo.attemptsImageLock(lockClient, n);
    } catch (_) {
      haveXlock = false;
    }
    if (haveXlock) break;
    if (!waitIfBusy) {
      console.log(`[img-dl] ${n}: wird bereits von einem anderen Worker geladen — übersprungen`);
      lockClient.release();
      return 'belegt';
    }
    if (k.uhr.jetzt() > deadline) {
      console.warn(`[img-dl] ${n}: Wartezeit auf anderen Worker überschritten — fahre ohne Lock fort`);
      break; // best effort ohne Lock weitermachen
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { lockClient, haveXlock };
}

// Je Set eine Sperre: Gleichzeitige Aufrufe für dasselbe Set warten auf den ersten.
const sperren = (k: CatalogContext) => k.faecher.fach('setBilder:sperren', () => new Map<string, Promise<void>>());

async function downloadSetImages(k: CatalogContext, setNumber: string, waitIfBusy = false) {
  const n = withVersion(setNumber);
  const _downloadLocks = sperren(k);
  if (_downloadLocks.has(n)) {
    await _downloadLocks.get(n);
    return;
  }
  // `!` ist beweisbar: Der Rumpf eines Promise-Konstruktors läuft synchron,
  // resolveLock ist also gesetzt.
  let resolveLock!: () => void;
  const lock = new Promise<void>(r => {
    resolveLock = r;
  });
  _downloadLocks.set(n, lock);

  const sperre = await fetchImageLock(k, n, waitIfBusy);
  if (sperre === 'belegt') {
    resolveLock();
    _downloadLocks.delete(n);
    return;
  }
  const { lockClient, haveXlock } = sperre;

  let _pendingAdded = 0; // Anteil dieses Batches am globalen imgDl-Zähler
  let _flushed = 0; // davon bereits an den Zähler gemeldet (Rest im finally)
  let _lastFlush = k.uhr.jetzt();
  try {
    const needsImg = await k.teileAnreicherung.imagesWithoutFile(n);
    if (!needsImg.length) return;

    console.log(`[img-dl] ${n}: lade ${needsImg.length} Bilder`);
    // Zum globalen Zähler ADDIEREN statt ihn zu überschreiben, sonst zeigte die
    // Überwachung nur den zuletzt gestarteten Stapel.
    _pendingAdded = needsImg.length;
    await imageLoadCounter(k, _pendingAdded);

    let done = 0;
    // Höchstens ein Schreibvorgang je Sekunde statt einer je Bild, das entlastet
    // den Pool. Der Zähler steigt VOR dem await, damit nichts doppelt meldet.
    const flushProgress = async (force?: boolean) => {
      const delta = done - _flushed;
      if (delta <= 0) return;
      if (!force && k.uhr.jetzt() - _lastFlush < 1000) return;
      _flushed += delta;
      _lastFlush = k.uhr.jetzt();
      await imageLoadCounter(k, -delta);
    };
    await Promise.all(
      needsImg.map(async p => {
        await loadPartImage(k, p);
        done++;
        await flushProgress(false);
      }),
    );
    await flushProgress(true);
    console.log(`[img-dl] ${n}: ${done}/${needsImg.length} Bilder geladen`);
  } finally {
    // Nur den noch nicht gemeldeten Rest verrechnen — deckt Abbruch ab, ohne im
    // Normalfall doppelt abzuziehen.
    const _rest = _pendingAdded - _flushed;
    if (_rest > 0) await imageLoadCounter(k, -_rest);
    if (lockClient) {
      if (haveXlock) await repo.giveImageLockFree(lockClient, n).catch(logAndContinue('teile-enrich:hashtext'));
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

export { downloadImage, downloadSetImages };
