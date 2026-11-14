/** Bilder eines Sets laden: Teile und Figuren aus dem CDN in den eigenen Ordner,
 * unter einer Sperre je Set, die auch andere Prozesse sehen. */
import { cdnImageLimiter } from './rateLimiter';
import { meldeFehler, logAndContinue } from '../infra/fehler';
import { mitVersion } from '../infra/setNummer';
import { setzeTeilBildLokal, setzeFigurBildLokal } from './katalogPflege';
import { BILD_KOPFZEILEN } from './quellen';

// Teile- und Figurenbilder liegen in getrennten Ordnern; downloadImage()
// bekommt deshalb die Art mit.
import { bildEndung, dateiTeil, zielImOrdner, ladeBild } from './bilder/bildDatei';
import { ERLAUBTE_BILD_HOSTS } from '../infra/fremdeAdressen';
import * as repo from './repository/teileAnreicherung';
import fs from 'node:fs';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR } from '../infra/appPaths';
import { generateThumb } from './bilder/thumbs';
import type { KatalogKontext } from './kontext';

/** @param kind Bestimmt Zielverzeichnis und Web-Pfad. */
async function downloadImage(
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
  const nummer = dateiTeil(partNum),
    farbe = dateiTeil(colorId);
  if (!nummer || !farbe) return null;
  const file = `${nummer}_${farbe}.${bildEndung(imgUrl)}`;
  const dest = zielImOrdner(IMG_DIR, file);
  if (!dest) return null;
  const rel = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!(await ladeBild(imgUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN))) return null;
  try {
    await generateThumb(rel).catch(logAndContinue('teile-enrich:generateThumb'));
  } catch (e) {
    meldeFehler('teile-enrich:vorschau', e);
  }
  return rel;
}

/** Ein Bild vom CDN in den Teile-Ordner, dann in den Katalog. */
async function ladeTeilbild(k: KatalogKontext, p: repo.Bildwunsch): Promise<void> {
  const rawUrl = p.image_url || '';
  let cdnUrl = rawUrl;
  // Beide Schreibweisen: Altzeilen tragen noch /api/img-proxy.
  const m = rawUrl.match(/\/api\/(?:v1\/)?img-proxy\?url=(.+)/);
  if (m) cdnUrl = decodeURIComponent(m[1] ?? '');
  if (!cdnUrl.startsWith('http')) {
    console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
    return;
  }

  const nummer = dateiTeil(p.id),
    farbe = dateiTeil(p.color_id);
  if (!nummer || (p.kind !== 'fig' && !farbe)) {
    console.warn(`[img-dl] skipping unsafe number ${String(p.id).substring(0, 40)}`);
    return;
  }
  const file = p.kind === 'fig' ? `${nummer}.${bildEndung(cdnUrl)}` : `${nummer}_${farbe}.${bildEndung(cdnUrl)}`;
  const dest = zielImOrdner(PART_IMAGES_DIR, file);
  if (!dest) return;
  const rel = `/images/parts/${file}`;

  if (!fs.existsSync(dest)) {
    await cdnImageLimiter.acquire();
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    const ok = await ladeBild(cdnUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN, text =>
      console.warn(`[img-dl] ${p.id}: ${text}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')),
    ).finally(() => cdnImageLimiter.release());
    if (!ok) return;
  }

  // Ein Schreibfehler bricht den Lauf ab, statt eine Datei ohne Verweis zu hinterlassen;
  // der nächste Lauf findet die Datei und schreibt nur den Verweis nach.
  if (p.kind === 'fig') await setzeFigurBildLokal(k, p.id, rel);
  else await setzeTeilBildLokal(k, p.id, p.color_id, rel);
}

/** Prozessübergreifend auf einer EIGENEN Verbindung: Ein Advisory-Lock hängt an
 * der Session, über den Pool würde er unzuverlässig freigegeben. waitIfBusy (PDF)
 * wartet auf den anderen Prozess, sonst fehlten Bilder im PDF. */
async function holeBildSperre(
  k: KatalogKontext,
  n: string,
  waitIfBusy: boolean,
): Promise<'belegt' | { lockClient: import('pg').PoolClient | null; haveXlock: boolean }> {
  let lockClient: import('pg').PoolClient | null = null,
    haveXlock = false;
  try {
    lockClient = await k.teileAnreicherung.sperrVerbindung();
  } catch (_) {
    lockClient = null;
  }
  if (!lockClient) return { lockClient, haveXlock };
  const deadline = Date.now() + 180000; // max. 3 Min auf anderen Worker warten
  while (true) {
    try {
      haveXlock = await repo.versucheBildSperre(lockClient, n);
    } catch (_) {
      haveXlock = false;
    }
    if (haveXlock) break;
    if (!waitIfBusy) {
      console.log(`[img-dl] ${n}: wird bereits von einem anderen Worker geladen — übersprungen`);
      lockClient.release();
      return 'belegt';
    }
    if (Date.now() > deadline) {
      console.warn(`[img-dl] ${n}: Wartezeit auf anderen Worker überschritten — fahre ohne Lock fort`);
      break; // best effort ohne Lock weitermachen
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { lockClient, haveXlock };
}

// Je Set eine Sperre: Gleichzeitige Aufrufe für dasselbe Set warten auf den ersten.
const _downloadLocks = new Map();

async function downloadSetImages(k: KatalogKontext, setNumber: string, waitIfBusy = false) {
  const n = mitVersion(setNumber);

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

  const sperre = await holeBildSperre(k, n, waitIfBusy);
  if (sperre === 'belegt') {
    resolveLock();
    _downloadLocks.delete(n);
    return;
  }
  const { lockClient, haveXlock } = sperre;

  let _pendingAdded = 0; // Anteil dieses Batches am globalen imgDl-Zähler
  let _flushed = 0; // davon bereits an den Zähler gemeldet (Rest im finally)
  let _lastFlush = Date.now();
  try {
    const needsImg = await k.teileAnreicherung.bilderOhneDatei(n);
    if (!needsImg.length) return;

    console.log(`[img-dl] ${n}: lade ${needsImg.length} Bilder`);
    // Zum globalen Zähler ADDIEREN statt ihn zu überschreiben, sonst zeigte die
    // Überwachung nur den zuletzt gestarteten Stapel.
    _pendingAdded = needsImg.length;
    await k.auftraege.imgDlAdd(_pendingAdded).catch(logAndContinue('teile-enrich:imgDlAdd'));

    let done = 0;
    // Höchstens ein Schreibvorgang je Sekunde statt einer je Bild, das entlastet
    // den Pool. Der Zähler steigt VOR dem await, damit nichts doppelt meldet.
    const flushProgress = async (force?: boolean) => {
      const delta = done - _flushed;
      if (delta <= 0) return;
      if (!force && Date.now() - _lastFlush < 1000) return;
      _flushed += delta;
      _lastFlush = Date.now();
      await k.auftraege.imgDlAdd(-delta).catch(logAndContinue('teile-enrich:imgDlAdd'));
    };
    await Promise.all(
      needsImg.map(async p => {
        await ladeTeilbild(k, p);
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
    if (_rest > 0) await k.auftraege.imgDlAdd(-_rest).catch(logAndContinue('teile-enrich:imgDlAdd'));
    if (lockClient) {
      if (haveXlock) await repo.gibBildSperreFrei(lockClient, n).catch(logAndContinue('teile-enrich:hashtext'));
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

export { downloadImage, downloadSetImages };
