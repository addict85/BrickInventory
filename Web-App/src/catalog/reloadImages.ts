/** Reload missing image files: find references without a file, load or clear them. */
import { errorMessage, logAndContinue, withoutMissingFile } from '../infra/error';

import { checkAbort, type JobRun } from '../jobQueue';
import * as repo from './repository/partsEnrichment';
import fs from 'node:fs';
import type { PoolClient } from 'pg';
import path from 'node:path';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { attempts } from '../infra/result';
import type { CatalogContext } from './context';

// "Missing" = image_local set, file missing. Unrecoverable
// entries are cleared so that the UIs fall back to the CDN address.

// For all three image kinds; otherwise the follow-up discarded set and figure images.
function _fsPathFromLocal(imageLocal: string) {
  if (!imageLocal) return null;
  const areas: Array<[string, string]> = [
    ['/images/parts/', PART_IMAGES_DIR],
    ['/images/minifigs/', MINIFIG_IMAGES_DIR],
    ['/images/sets/', SET_IMAGES_DIR],
  ];
  for (const [prefix, dir] of areas) {
    if (!imageLocal.startsWith(prefix)) continue;
    const file = imageLocal.slice(prefix.length);
    // Path separators and .. stay forbidden: even a value from the database is
    // not trustworthy per se.
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    return path.join(dir, file);
  }
  return null;
}

// With await, otherwise the final state would be lost on a restart.
async function _redownloadSetStatus(k: CatalogContext, obj: Record<string, unknown>) {
  await k.jobQueue
    .setState('imgredl_status', JSON.stringify({ ...obj, at: k.uhr.jetzt() }))
    .catch(logAndContinue('teile-enrich:setzeZustand'));
}

async function redownloadMissingImages(k: CatalogContext, lauf?: JobRun) {
  const lauf_ = k.faecher.slot('bilderNachladen', () => ({ laeuft: false }));
  if (lauf_.laeuft) return { alreadyRunning: true };
  // Lock on an OWN connection: advisory locks are bound to the session.
  let lockClient: PoolClient;
  try {
    lockClient = await k.partsEnrichment.lockConnection();
  } catch (e) {
    return { error: errorMessage(e) || 'keine Verbindung' };
  }
  try {
    if (!(await repo.attemptsFollowUpLock(lockClient))) {
      lockClient.release();
      return { alreadyRunning: true };
    }
  } catch (e) {
    lockClient.release();
    return { error: errorMessage(e) || 'Sperre fehlgeschlagen' };
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
    await _redownloadSetStatus(k, { running: true, phase: 'scanning', total: 0, done: 0, redownloaded: 0, cleared: 0 });
    const { missing, withoutPreview } = await searchMissingFiles(k);
    const thumbsCreated = await catchUpPreviews(k, withoutPreview);
    const total = missing.length;
    await _redownloadSetStatus(k, { running: true, phase: 'downloading', total, done: 0, redownloaded: 0, cleared: 0 });
    if (!total) {
      await _redownloadSetStatus(k, {
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

    await _redownloadSetStatus(k, {
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
    await _redownloadSetStatus(k, { running: false, phase: 'error', error: errorMessage(e) });
    if (lauf?.signal?.aborted) throw e;
    console.error('[img-redl] Fehler:', errorMessage(e));
    return { error: errorMessage(e) };
  }
}

const givesFile = (fp: string) =>
  fs.promises
    .access(fp)
    .then(() => true)
    .catch(withoutMissingFile('teile-enrich:access', false));

/** Missing previews too: otherwise they only arise on capture and would have
 * no second chance. */
async function searchMissingFiles(k: CatalogContext) {
  const rows = await k.partsEnrichment.localImagesWithAddress();
  const missing: MissingImage[] = [];
  const withoutPreview: string[] = [];
  for (const r of rows) {
    const fp = _fsPathFromLocal(r.image_local);
    if (!fp) continue; // skip bundled /images/ or similar
    if (!(await givesFile(fp))) {
      missing.push({ image_local: r.image_local, image_url: r.image_url, fp });
      continue;
    }
    if (!(await givesFile(fp.replace(/(\.[^.]+)$/, '_thumb.jpg')))) withoutPreview.push(r.image_local);
  }
  return { missing, withoutPreview };
}

/** Previews first: they need no network and take effect immediately on every tile wall. */
async function catchUpPreviews(k: CatalogContext, withoutPreview: string[]): Promise<number> {
  let thumbsCreated = 0;
  if (!withoutPreview.length) return 0;
  await _redownloadSetStatus(k, {
    running: true,
    phase: 'thumbs',
    total: withoutPreview.length,
    done: 0,
    redownloaded: 0,
    cleared: 0,
  });
  for (const web of withoutPreview) {
    const r = await attempts('teile-enrich:vorschau', () => k.images.createPreview(web));
    if (r.ok && r.wert) thumbsCreated++;
  }
  console.log(`[img-redl] ${thumbsCreated} fehlende Vorschauen erzeugt (von ${withoutPreview.length})`);
  return thumbsCreated;
}

/** Reload what has an address; otherwise clear the reference so that the tile does not
 * point to a file that does not exist. */
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
    await _redownloadSetStatus(k, { running: true, phase: 'downloading', total, done, redownloaded, cleared });
  };

  let idx = 0;
  const worker = async () => {
    while (idx < missing.length && !lauf?.signal?.aborted) {
      const m = missing[idx++];
      if (!m) break;
      if (await reloadImage(k, m)) redownloaded++;
      else {
        // The list MUST match the tables that really have the column.
        for (const tbl of repo.CATALOGS_WITH_IMAGE) {
          await k.partsEnrichment.forgetLocalImage(tbl, m.image_local).catch(logAndContinue(`img-redl:leeren ${tbl}`));
        }
        cleared++;
      }
      done++;
      await flush(false);
    }
  };
  const CONC = 2; // as with the normal download; the CDN limiter throttles anyway
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  return { done, redownloaded, cleared };
}

async function reloadImage(k: CatalogContext, m: MissingImage): Promise<boolean> {
  let ok = false;
  if (m.image_url) {
    await k.cdnDrossel.acquire();
    try {
      // An error counts like a fruitless fetch; the counter names both.
      const r = await attempts('teile-enrich:downloadFile', k.externalSources.quellen.downloadFile(m.image_url, m.fp));
      ok = r.ok && r.wert === true;
    } finally {
      k.cdnDrossel.release();
    }
  }
  if (ok) await k.images.createPreview(m.image_local).catch(logAndContinue('teile-enrich:vorschauErzeugenAus'));
  return ok;
}

export { redownloadMissingImages };
