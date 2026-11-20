/** Fehlende Bilddateien nachladen: Verweise ohne Datei finden, laden oder leeren. */
import { fehlertext, logAndContinue, withoutMissingFile } from '../infra/error';

import { checkAbort, type JobRun } from '../jobQueue';
import * as repo from './repository/partsEnrichment';
import fs from 'node:fs';
import type { PoolClient } from 'pg';
import path from 'node:path';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { versuche } from '../infra/result';
import type { CatalogContext } from './context';

// „Fehlend" = image_local gesetzt, Datei fehlt. Nicht wiederherstellbare
// Einträge werden geleert, damit die Oberflächen auf die CDN-Adresse zurückfallen.

// Für alle drei Bildarten; sonst verwarf der Nachlauf Set- und Figurenbilder.
function _fsPathFromLocal(imageLocal: string) {
  if (!imageLocal) return null;
  const bereiche: Array<[string, string]> = [
    ['/images/parts/', PART_IMAGES_DIR],
    ['/images/minifigs/', MINIFIG_IMAGES_DIR],
    ['/images/sets/', SET_IMAGES_DIR],
  ];
  for (const [prefix, dir] of bereiche) {
    if (!imageLocal.startsWith(prefix)) continue;
    const file = imageLocal.slice(prefix.length);
    // Pfadtrenner und .. bleiben verboten: Auch ein Wert aus der Datenbank ist
    // nicht per se vertrauenswürdig.
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    return path.join(dir, file);
  }
  return null;
}

// Mit await, sonst ginge der Endstand bei einem Neustart verloren.
async function _redlSetStatus(k: CatalogContext, obj: Record<string, unknown>) {
  await k.jobQueue
    .setzeZustand('imgredl_status', JSON.stringify({ ...obj, at: k.uhr.jetzt() }))
    .catch(logAndContinue('teile-enrich:setzeZustand'));
}

async function redownloadMissingImages(k: CatalogContext, lauf?: JobRun) {
  const lauf_ = k.faecher.fach('bilderNachladen', () => ({ laeuft: false }));
  if (lauf_.laeuft) return { alreadyRunning: true };
  // Sperre auf EIGENER Verbindung: Advisory-Locks hängen an der Session.
  let lockClient: PoolClient;
  try {
    lockClient = await k.teileAnreicherung.lockConnection();
  } catch (e) {
    return { error: fehlertext(e) || 'keine Verbindung' };
  }
  try {
    if (!(await repo.attemptsFollowUpLock(lockClient))) {
      lockClient.release();
      return { alreadyRunning: true };
    }
  } catch (e) {
    lockClient.release();
    return { error: fehlertext(e) || 'Sperre fehlgeschlagen' };
  }
  lauf_.laeuft = true;
  try {
    return await _redownloadMissingImages(k, lauf);
  } finally {
    lauf_.laeuft = false;
    await repo.giveFollowUpLockFree(lockClient).catch(logAndContinue('teile-enrich:pg_advisory_unlock'));
    lockClient.release();
  }
}

type MissingImage = { image_local: string; image_url: string | null; fp: string };

async function _redownloadMissingImages(k: CatalogContext, lauf?: JobRun) {
  try {
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    await _redlSetStatus(k, { running: true, phase: 'scanning', total: 0, done: 0, redownloaded: 0, cleared: 0 });
    const { missing, withoutPreview } = await searchMissingFiles(k);
    const thumbsCreated = await catchUpPreviews(k, withoutPreview);
    const total = missing.length;
    await _redlSetStatus(k, { running: true, phase: 'downloading', total, done: 0, redownloaded: 0, cleared: 0 });
    if (!total) {
      await _redlSetStatus(k, {
        running: false,
        phase: 'done',
        total: 0,
        done: 0,
        redownloaded: 0,
        cleared: 0,
        thumbs: thumbsCreated,
      });
      return { total: 0, redownloaded: 0, cleared: 0, thumbs: thumbsCreated };
    }

    const { done, redownloaded, cleared } = await reloadMissing(k, missing, lauf);
    checkAbort(lauf);

    await _redlSetStatus(k, {
      running: false,
      phase: 'done',
      total,
      done,
      redownloaded,
      cleared,
      thumbs: thumbsCreated,
    });
    console.log(
      `[img-redl] fertig: ${redownloaded} neu geladen, ${cleared} geleert (von ${total} fehlenden), ${thumbsCreated} Vorschauen erzeugt`,
    );
    return { total, redownloaded, cleared, thumbs: thumbsCreated };
  } catch (e) {
    await _redlSetStatus(k, { running: false, phase: 'error', error: fehlertext(e) });
    if (lauf?.signal?.aborted) throw e;
    console.error('[img-redl] Fehler:', fehlertext(e));
    return { error: fehlertext(e) };
  }
}

const givesFile = (fp: string) =>
  fs.promises
    .access(fp)
    .then(() => true)
    .catch(withoutMissingFile('teile-enrich:access', false));

/** Auch fehlende Vorschauen: Sie entstehen sonst nur beim Erfassen und hätten
 * keinen zweiten Anlauf. */
async function searchMissingFiles(k: CatalogContext) {
  const rows = await k.teileAnreicherung.localImagesWithAddress();
  const missing: MissingImage[] = [];
  const withoutPreview: string[] = [];
  for (const r of rows) {
    const fp = _fsPathFromLocal(r.image_local);
    if (!fp) continue; // gebündelte /images/ o.ä. überspringen
    if (!(await givesFile(fp))) {
      missing.push({ image_local: r.image_local, image_url: r.image_url, fp });
      continue;
    }
    if (!(await givesFile(fp.replace(/(\.[^.]+)$/, '_thumb.jpg')))) withoutPreview.push(r.image_local);
  }
  return { missing, withoutPreview };
}

/** Vorschauen zuerst: Sie brauchen kein Netz und wirken sofort auf jede Kachelwand. */
async function catchUpPreviews(k: CatalogContext, withoutPreview: string[]): Promise<number> {
  let thumbsCreated = 0;
  if (!withoutPreview.length) return 0;
  await _redlSetStatus(k, {
    running: true,
    phase: 'thumbs',
    total: withoutPreview.length,
    done: 0,
    redownloaded: 0,
    cleared: 0,
  });
  for (const web of withoutPreview) {
    const r = await versuche('teile-enrich:vorschau', () => k.images.createPreview(web));
    if (r.ok && r.wert) thumbsCreated++;
  }
  console.log(`[img-redl] ${thumbsCreated} fehlende Vorschauen erzeugt (von ${withoutPreview.length})`);
  return thumbsCreated;
}

/** Neu laden, was eine Adresse hat; sonst den Verweis leeren, damit die Kachel nicht
 * auf eine Datei zeigt, die es nicht gibt. */
async function reloadMissing(k: CatalogContext, missing: MissingImage[], lauf?: JobRun) {
  const total = missing.length;
  let done = 0,
    redownloaded = 0,
    cleared = 0,
    _lastFlush = 0;
  const flush = async (force?: boolean) => {
    const now = k.uhr.jetzt();
    if (!force && now - _lastFlush < 1000) return;
    _lastFlush = now;
    await _redlSetStatus(k, { running: true, phase: 'downloading', total, done, redownloaded, cleared });
  };

  let idx = 0;
  const worker = async () => {
    while (idx < missing.length && !lauf?.signal?.aborted) {
      const m = missing[idx++];
      if (!m) break;
      if (await reloadImage(k, m)) redownloaded++;
      else {
        // Die Liste MUSS zu den Tabellen passen, die die Spalte wirklich haben.
        for (const tbl of repo.CATALOGS_WITH_IMAGE) {
          await k.teileAnreicherung
            .forgetLocalImage(tbl, m.image_local)
            .catch(logAndContinue(`img-redl:leeren ${tbl}`));
        }
        cleared++;
      }
      done++;
      await flush(false);
    }
  };
  const CONC = 2; // wie beim normalen Download; der CDN-Limiter drosselt ohnehin
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  return { done, redownloaded, cleared };
}

async function reloadImage(k: CatalogContext, m: MissingImage): Promise<boolean> {
  let ok = false;
  if (m.image_url) {
    await k.cdnDrossel.acquire();
    try {
      // Ein Fehler zählt wie ein vergeblicher Abruf; der Zähler nennt beide.
      const r = await versuche('teile-enrich:downloadFile', k.externalSources.quellen.downloadFile(m.image_url, m.fp));
      ok = r.ok && r.wert === true;
    } finally {
      k.cdnDrossel.release();
    }
  }
  if (ok) await k.images.createPreview(m.image_local).catch(logAndContinue('teile-enrich:vorschauErzeugenAus'));
  return ok;
}

export { redownloadMissingImages };
