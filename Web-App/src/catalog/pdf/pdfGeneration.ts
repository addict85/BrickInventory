import fsp from 'node:fs/promises';
import path from 'node:path';
import { MINIFIG_IMAGES_DIR } from '../../infra/appPaths';
import { logAndContinue, reportError } from '../../infra/fehler';
import { type Nutzlast, checkAbort, type JobRun } from '../../auftraege';
import { pdfFilePath } from './pdfJobs';
import { downloadImage, downloadSetImages } from '../partsEnrichment';
import { drawPdfInThread, type PdfTeil } from './pdfDrawing';
import { KEINE_FARBE } from '../../infra/validate';
import { rememberMinifigImageAddress, setMinifigImageLocal, setPartImageLocal } from '../catalogMaintenance';
import { normalisiereSetNummer, possibleSetNumber } from '../../infra/setNummer';
import { imagesFromCatalog as readImagesFromCatalog } from '../imageState';
import type { CatalogContext } from '../context';

/** Erst fehlende Bilder holen, dann im eigenen Faden zeichnen. */
export type PdfPayload = Nutzlast<'pdf'>;

const isMinifig = (p: PdfTeil) => !!p.is_fig || String(p.part_number).startsWith('fig-');
const cdnAddress = (url: string) => {
  const roh = url.match(/\/api\/img-proxy\?url=(.+)/)?.[1];
  return roh ? decodeURIComponent(roh) : url;
};

/** Nur geprüfte Bildquellen aus dem Katalog (src/catalog/imageState.ts). */
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

/** Figurenbilder lagen unter zwei Schreibweisen auf der Platte; die gefundene merken. */
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
  const ziel = pdfFilePath(jobId);
  if (!ziel) throw new Error(`ungültige Auftragskennung ${jobId}`);
  const setNumbers = [...new Set(sets.map(s => normalisiereSetNummer(s?.set_number ?? '')).filter(possibleSetNumber))];
  // Warten, falls ein anderer Prozess dieselben Bilder lädt — sonst fehlten sie im PDF.
  for (const sn of setNumbers) {
    checkAbort(lauf);
    await downloadSetImages(k, sn, true).catch(logAndContinue(`pdf:bilder ${sn}`));
  }
  await imagesFromCatalog(k, parts);
  await minifigsWithoutAddress(k, parts);
  await minifigsOnTheDisk(k, parts);
  // Was dann noch fehlt (Teil nicht im Set-Katalog, abweichende Farbe), einzeln.
  for (const p of parts.filter(p => !p.image_local && p.image_url)) {
    checkAbort(lauf);
    const figur = isMinifig(p);
    const lokal = await downloadImage(
      k,
      cdnAddress(p.image_url!),
      p.part_number,
      figur ? 0 : (p.color_id ?? KEINE_FARBE),
      figur ? 'minifig' : 'part',
    ).catch(logAndContinue(`pdf:bild ${p.part_number}`));
    if (!lokal) continue;
    p.image_local = lokal;
    await (figur
      ? setMinifigImageLocal(k, p.part_number, lokal)
      : setPartImageLocal(k, p.part_number, p.color_id ?? KEINE_FARBE, lokal)
    ).catch(logAndContinue(`pdf:bildpfad ${p.part_number}`));
  }
  const withImage = parts.filter(p => p.image_local).length;
  if (withImage < parts.length) console.log(`[PDF job] ${jobId}: ${withImage}/${parts.length} Bilder vorhanden`);

  checkAbort(lauf);
  await fsp.mkdir(path.dirname(ziel), { recursive: true });
  await drawPdfInThread(sets, parts, ziel);
  console.log(`[PDF job] ${jobId} fertig für Konto ${uid}`);
}

async function pdfGivenUp(n: PdfPayload, fehler: string): Promise<void> {
  console.error(`[PDF job] ${n.job_id} error:`, fehler);
}

export { createPdf, pdfGivenUp };
