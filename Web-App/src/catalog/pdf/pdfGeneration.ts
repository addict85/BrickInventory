import fsp from 'node:fs/promises';
import path from 'node:path';
import { MINIFIG_IMAGES_DIR } from '../../infra/appPaths';
import { logAndContinue, reportError } from '../../infra/error';
import { type Payload, checkAbort, type JobRun } from '../../jobQueue';
import { pdfFilePath } from './pdfJobs';
import { downloadImage, downloadSetImages } from '../partsEnrichment';
import { drawPdfInThread, type PdfTeil } from './pdfDrawing';
import { NO_COLOR } from '../../infra/validate';
import { rememberMinifigImageAddress, setMinifigImageLocal, setPartImageLocal } from '../catalogMaintenance';
import { normalizeSetNumber, possibleSetNumber } from '../../infra/setNumber';
import { imagesFromCatalog as readImagesFromCatalog } from '../imageState';
import type { CatalogContext } from '../context';

/** Fetch missing images first, then draw in a thread of its own. */
export type PdfPayload = Payload<'pdf'>;

const isMinifig = (p: PdfTeil) => !!p.is_fig || String(p.part_number).startsWith('fig-');
const cdnAddress = (url: string) => {
  const raw = url.match(/\/api\/img-proxy\?url=(.+)/)?.[1];
  return raw ? decodeURIComponent(raw) : url;
};

/** Only verified image sources from the catalog (src/catalog/imageState.ts). */
export const imagesFromCatalog = (k: CatalogContext, parts: PdfTeil[]) => readImagesFromCatalog(k, parts, isMinifig);

async function minifigsWithoutAddress(k: CatalogContext, parts: PdfTeil[]) {
  for (const p of parts.filter(
    p => isMinifig(p) && !p.image_url && !p.image_local && /^fig-\d{1,8}$/.test(p.part_number),
  )) {
    try {
      const info = await k.externalSources.quellen.getMinifigInfo(p.part_number);
      if (!info?.image_url) continue;
      p.image_url = info.image_url;
      await rememberMinifigImageAddress(k, p.part_number, info.image_url).catch(logAndContinue('pdf:figurbild merken'));
    } catch (e) {
      reportError('pdf:figurbild holen', e);
    }
  }
}

/** Figure images were stored on disk under two spellings; remember the one found. */
async function minifigsOnTheDisk(k: CatalogContext, parts: PdfTeil[]) {
  for (const p of parts.filter(p => isMinifig(p) && !p.image_local && p.image_url)) {
    const cdn = cdnAddress(p.image_url || '');
    const ext = ((cdn.split('.').pop() || '').split('?')[0] || 'jpg').substring(0, 4).toLowerCase();
    for (const name of [
      `${p.part_number.replace(/[^a-z0-9-]/gi, '_')}.${ext}`,
      `${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`,
      `fig_${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`,
    ]) {
      const da = await fsp.access(path.join(MINIFIG_IMAGES_DIR, name)).then(
        () => true,
        () => false,
      );
      if (!da) continue;
      p.image_local = `/images/minifigs/${name}`;
      await setMinifigImageLocal(k, p.part_number, p.image_local).catch(logAndContinue('pdf:figurbild pfad merken'));
      break;
    }
  }
}

async function createPdf(k: CatalogContext, n: PdfPayload, lauf?: JobRun): Promise<void> {
  const { job_id: jobId, user_id: uid, sets = [], parts = [] } = n;
  const target = pdfFilePath(jobId);
  if (!target) throw new Error(`ungültige Auftragskennung ${jobId}`);
  const setNumbers = [...new Set(sets.map(s => normalizeSetNumber(s?.set_number ?? '')).filter(possibleSetNumber))];
  // Wait in case another process is loading the same images — otherwise they would be missing from the PDF.
  for (const sn of setNumbers) {
    checkAbort(lauf);
    await downloadSetImages(k, sn, true).catch(logAndContinue(`pdf:bilder ${sn}`));
  }
  await imagesFromCatalog(k, parts);
  await minifigsWithoutAddress(k, parts);
  await minifigsOnTheDisk(k, parts);
  // Whatever is still missing then (part not in the set catalog, different color), one by one.
  for (const p of parts.filter(p => !p.image_local && p.image_url)) {
    checkAbort(lauf);
    const minifig = isMinifig(p);
    const local = await downloadImage(
      k,
      cdnAddress(p.image_url!),
      p.part_number,
      minifig ? 0 : (p.color_id ?? NO_COLOR),
      minifig ? 'minifig' : 'part',
    ).catch(logAndContinue(`pdf:bild ${p.part_number}`));
    if (!local) continue;
    p.image_local = local;
    await (minifig
      ? setMinifigImageLocal(k, p.part_number, local)
      : setPartImageLocal(k, p.part_number, p.color_id ?? NO_COLOR, local)
    ).catch(logAndContinue(`pdf:bildpfad ${p.part_number}`));
  }
  const withImage = parts.filter(p => p.image_local).length;
  if (withImage < parts.length) console.log(`[PDF job] ${jobId}: ${withImage}/${parts.length} Bilder vorhanden`);

  checkAbort(lauf);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await drawPdfInThread(sets, parts, target);
  console.log(`[PDF job] ${jobId} fertig für Konto ${uid}`);
}

async function pdfGivenUp(n: PdfPayload, error: string): Promise<void> {
  console.error(`[PDF job] ${n.job_id} error:`, error);
}

export { createPdf, pdfGivenUp };
