import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, IMAGES_DIR } from '../infra/appPaths';
import { KEINE_FARBE } from '../infra/validate';
import { versuche } from '../infra/result';
import { anleitungEinreihen } from './instructionJob';
import type { CatalogContext } from './context';

export async function imagesForFollowUp(k: CatalogContext) {
  const [sets, teile, figuren] = await Promise.all([
    k.bildlage.setsWithMissingCatalogImages(),
    // The shared catalog only lists verified addresses: the file applies to all accounts.
    k.bildlage.manualPartsWithoutImage(),
    // All figures, not only manual ones: otherwise every tile would go through the proxy.
    k.bildlage.minifigsWithoutImage(),
  ]);
  return { sets, teile, figuren };
}

/** Existing data stays. @returns whether Brickset knows the set */
export async function fillFromBrickset(k: CatalogContext, setNumber: string): Promise<boolean> {
  const info = await k.externalSources.quellen.setAngaben(setNumber);
  if (!info) return false;
  // If it fails, it throws: the job tries again instead of leaving the set nameless.
  await k.bildlage.fillSetGaps(setNumber, info);
  return true;
}

export type Bildposten = {
  part_number: string;
  color_id?: number | null | undefined;
  image_url?: string | null | undefined;
  image_local?: string | null | undefined;
};

/** Only from a verified source: the files apply to all accounts, an image from the
 * client would otherwise end up with all the others. */
export async function imagesFromCatalog<T extends Bildposten>(
  k: CatalogContext,
  posten: T[],
  isMinifig: (p: T) => boolean,
): Promise<void> {
  for (const p of posten) {
    p.image_url = null;
    p.image_local = null;
  }
  const teile = posten.filter(p => !isMinifig(p)),
    figuren = posten.filter(isMinifig);
  if (teile.length) {
    const zeilen = await k.bildlage.partImages([...new Set(teile.map(p => String(p.part_number)))]);
    const m = new Map(zeilen.map(r => [`${r.part_number}|${r.color_id}`, r] as const));
    for (const p of teile) {
      const z = m.get(`${p.part_number}|${p.color_id ?? KEINE_FARBE}`);
      if (z) {
        p.image_local = z.image_local;
        p.image_url = z.image_url;
      }
    }
  }
  if (!figuren.length) return;
  const zeilen = await k.bildlage.minifigImages([...new Set(figuren.map(p => String(p.part_number)))]);
  const m = new Map(zeilen.map(r => [r.fig_number, r] as const));
  for (const p of figuren) {
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
  const missing = await k.bildlage.setsWithoutInstructionFetch();
  if (missing.length) console.log(`[instr-queue] Enqueueing ${missing.length} sets missing instructions`);
  for (const set_number of missing) await anleitungEinreihen(k, set_number);
}

/** The UI only loads from images/sets via image_local; without the entry
 * every set image would keep going through the proxy although the file has long been there. */
export async function enterSetImageLocal(
  k: CatalogContext,
  setNumber: string,
  quelle: string | null = null,
): Promise<void> {
  const safe = setNumber.replace(/[^a-z0-9-]/gi, '_');
  await k.bildlage.rememberSetImageLocal(setNumber, `/images/sets/${safe}.jpg`, quelle);
}

export async function reloadSetImages(k: CatalogContext): Promise<void> {
  const missing = await k.bildlage.setImagesWithoutFile();
  if (!missing.length) return;
  console.log(`[set-img-bg] Downloading ${missing.length} missing set images…`);
  let gescheitert = 0;
  for (const { set_number, image_url } of missing) {
    // Only 404/410 means "does not exist"; throttling ends the run, everything else is tried by the next one.
    const info: { status?: number } = {};
    const r = await versuche('nachlauf:setBildHerunterladen', k.images.setBildLaden(image_url, set_number, info));
    const local = r.ok ? r.wert : null;
    if (!local && (info.status === 404 || info.status === 410))
      k.images.rememberMissing('set:' + set_number, `HTTP ${info.status} vom CDN`);
    if (!local && (info.status === 403 || info.status === 429)) {
      console.warn(`[set-img-bg] CDN drosselt (HTTP ${info.status}) — Rest im nächsten Lauf`);
      break;
    }
    // A failure counts in the summary; the next run finds the image without an entry again.
    if (local && !(await versuche(`bilder:set ${set_number}`, k.bildlage.rememberSetImageLocal(set_number, local))).ok)
      gescheitert++;
    if (local && !(await versuche('nachlauf:vorschauErzeugenAus', k.images.createPreview(local))).ok) gescheitert++;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[set-img-bg] Done${gescheitert ? `, ${gescheitert} Schritte gescheitert` : ''}`);
}

/** Checked asynchronously so that the run does not block the event loop. */
export async function backfillThumbnails(k: CatalogContext): Promise<void> {
  const paths = await k.bildlage.localCatalogImages();
  let generated = 0,
    gescheitert = 0;
  const exists = (fp: string) =>
    fs.promises.access(fp).then(
      () => true,
      () => false,
    );
  const datei = (localPath: string) =>
    localPath.startsWith('/images/')
      ? path.join(IMAGES_DIR, localPath.slice('/images/'.length))
      : localPath.startsWith('/data/')
        ? path.join(APP_ROOT, localPath.slice(1))
        : null;
  const lokale = paths.flatMap(web => {
    const d = datei(web);
    return d ? [{ web, datei: d }] : [];
  });
  await versuche('nachlauf:vorschauen einpassen', k.images.fitTailoredPreviews(lokale));
  for (const { web: localPath, datei: fsPath } of lokale) {
    const thumbPath = fsPath.replace(path.extname(fsPath), '_thumb.jpg');
    if ((await exists(thumbPath)) || !(await exists(fsPath))) continue;
    if ((await versuche('nachlauf:vorschauErzeugenAus', k.images.createPreview(localPath))).ok) generated++;
    else gescheitert++;
    if (generated % 10 === 0) await new Promise(r => setTimeout(r, 10));
  }
  if (generated > 0 || gescheitert > 0)
    console.log(`  🖼️  ${generated} Thumbnails generiert${gescheitert ? `, ${gescheitert} gescheitert` : ''}`);
}
