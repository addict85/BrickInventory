import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, IMAGES_DIR } from '../infra/appPaths';
import { NO_COLOR } from '../infra/validate';
import { attempts } from '../infra/result';
import { enqueueInstruction } from './instructionJob';
import type { CatalogContext } from './context';

export async function imagesForFollowUp(k: CatalogContext) {
  const [sets, parts, minifigs] = await Promise.all([
    k.imageState.setsWithMissingCatalogImages(),
    // The shared catalog only lists verified addresses: the file applies to all accounts.
    k.imageState.manualPartsWithoutImage(),
    // All figures, not only manual ones: otherwise every tile would go through the proxy.
    k.imageState.minifigsWithoutImage(),
  ]);
  return { sets, parts, minifigs };
}

/** Existing data stays. @returns whether Brickset knows the set */
export async function fillFromBrickset(k: CatalogContext, setNumber: string): Promise<boolean> {
  const info = await k.externalSources.sources.setDetails(setNumber);
  if (!info) return false;
  // If it fails, it throws: the job tries again instead of leaving the set nameless.
  await k.imageState.fillSetGaps(setNumber, info);
  return true;
}

export type ImageItem = {
  part_number: string;
  color_id?: number | null | undefined;
  image_url?: string | null | undefined;
  image_local?: string | null | undefined;
};

/** Only from a verified source: the files apply to all accounts, an image from the
 * client would otherwise end up with all the others. */
export async function imagesFromCatalog<T extends ImageItem>(
  k: CatalogContext,
  item: T[],
  isMinifig: (p: T) => boolean,
): Promise<void> {
  for (const p of item) {
    p.image_url = null;
    p.image_local = null;
  }
  const parts = item.filter(p => !isMinifig(p)),
    minifigs = item.filter(isMinifig);
  if (parts.length) {
    const rows = await k.imageState.partImages([...new Set(parts.map(p => String(p.part_number)))]);
    const m = new Map(rows.map(r => [`${r.part_number}|${r.color_id}`, r] as const));
    for (const p of parts) {
      const z = m.get(`${p.part_number}|${p.color_id ?? NO_COLOR}`);
      if (z) {
        p.image_local = z.image_local;
        p.image_url = z.image_url;
      }
    }
  }
  if (!minifigs.length) return;
  const rows = await k.imageState.minifigImages([...new Set(minifigs.map(p => String(p.part_number)))]);
  const m = new Map(rows.map(r => [r.fig_number, r] as const));
  for (const p of minifigs) {
    const z = m.get(String(p.part_number));
    if (z) {
      p.image_local = z.image_local;
      p.image_url = z.image_url;
    }
  }
}

/** Not while a fetch is waiting or recently ran without a result — again
 * afterwards, as soon as the finished jobs expire. */
export async function backfillInstructions(k: CatalogContext): Promise<void> {
  const missing = await k.imageState.setsWithoutInstructionFetch();
  if (missing.length) console.log(`[instr-queue] Enqueueing ${missing.length} sets missing instructions`);
  for (const set_number of missing) await enqueueInstruction(k, set_number);
}

/** The UI only loads from images/sets via image_local; without the entry
 * every set image would keep going through the proxy although the file has long been there. */
export async function enterSetImageLocal(
  k: CatalogContext,
  setNumber: string,
  source: string | null = null,
): Promise<void> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  await k.imageState.rememberSetImageLocal(setNumber, `/images/sets/${safe}.jpg`, source);
}

export async function reloadSetImages(k: CatalogContext): Promise<void> {
  const missing = await k.imageState.setImagesWithoutFile();
  if (!missing.length) return;
  console.log(`[set-img-bg] Downloading ${missing.length} missing set images…`);
  let failed = 0;
  for (const { set_number, image_url } of missing) {
    // Only 404/410 means "does not exist"; throttling ends the run, everything else is tried by the next one.
    const info: { status?: number } = {};
    const r = await attempts('followup:setBildHerunterladen', k.images.loadSetImage(image_url, set_number, info));
    const local = r.ok ? r.wert : null;
    if (!local && (info.status === 404 || info.status === 410))
      k.images.rememberMissing('set:' + set_number, `HTTP ${info.status} vom CDN`);
    if (!local && (info.status === 403 || info.status === 429)) {
      console.warn(`[set-img-bg] CDN drosselt (HTTP ${info.status}) — Rest im nächsten Lauf`);
      break;
    }
    // A failure counts in the summary; the next run finds the image without an entry again.
    if (
      local &&
      !(await attempts(`images:set ${set_number}`, k.imageState.rememberSetImageLocal(set_number, local))).ok
    )
      failed++;
    if (local && !(await attempts('followup:vorschauErzeugenAus', k.images.createPreview(local))).ok) failed++;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[set-img-bg] Done${failed ? `, ${failed} Schritte gescheitert` : ''}`);
}

/** Checked asynchronously so that the run does not block the event loop. */
export async function backfillThumbnails(k: CatalogContext): Promise<void> {
  const paths = await k.imageState.localCatalogImages();
  let generated = 0,
    failed = 0;
  const exists = (fp: string) =>
    fs.promises.access(fp).then(
      () => true,
      () => false,
    );
  const file = (localPath: string) =>
    localPath.startsWith('/images/')
      ? path.join(IMAGES_DIR, localPath.slice('/images/'.length))
      : localPath.startsWith('/data/')
        ? path.join(APP_ROOT, localPath.slice(1))
        : null;
  const local = paths.flatMap(web => {
    const d = file(web);
    return d ? [{ web, file: d }] : [];
  });
  await attempts('followup:vorschauen einpassen', k.images.fitTailoredPreviews(local));
  for (const { web: localPath, file: fsPath } of local) {
    const thumbPath = fsPath.replace(path.extname(fsPath), '_thumb.jpg');
    if ((await exists(thumbPath)) || !(await exists(fsPath))) continue;
    if ((await attempts('followup:vorschauErzeugenAus', k.images.createPreview(localPath))).ok) generated++;
    else failed++;
    if (generated % 10 === 0) await new Promise(r => setTimeout(r, 10));
  }
  if (generated > 0 || failed > 0)
    console.log(`  🖼️  ${generated} Thumbnails generiert${failed ? `, ${failed} gescheitert` : ''}`);
}
