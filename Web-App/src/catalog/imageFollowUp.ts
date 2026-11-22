/** Hourly, the first one 30 s after startup (src/jobQueue/schedule.ts). */
import { logAndContinue, reportError } from '../infra/error';
import { setPartImageLocal, setMinifigImageLocal } from './catalogMaintenance';
import { NO_COLOR } from '../infra/validate';
import * as enrich from './partsEnrichment';
import { JobInterrupted, type JobContext } from '../jobQueue';
import { versuche } from '../infra/result';
import { imagesForFollowUp } from './imageState';
import type { CatalogContext } from './context';

async function imageFollowUp(kx: CatalogContext, k: JobContext): Promise<void> {
  const { sets, teile: manualParts, figuren: figsToFetch } = await imagesForFollowUp(kx);
  if (!sets.length && !manualParts.length && !figsToFetch.length) {
    await k.fortschritt({ erledigt: 0, gesamt: 0, text: 'Alle Bilder gecacht' });
    return;
  }
  console.log(
    `[img-dl-bg] fehlende Bilder: ${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`,
  );
  let done = 0;
  const total = sets.length + manualParts.length + figsToFetch.length;
  await k.fortschritt({
    erledigt: 0,
    gesamt: total,
    text: `${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`,
  });
  const tick = async () => {
    done++;
    if (done % 10 === 0 || done === total) {
      await k.fortschritt({ erledigt: done, gesamt: total, text: `${done} / ${total} geladen` });
    }
    if (k.ended) throw new JobInterrupted();
  };
  for (const set_number of sets) {
    await enrich.downloadSetImages(kx, set_number).catch((e: unknown) => reportError(`bild-nachlauf:${set_number}`, e));
    await tick();
  }
  for (const p of manualParts) {
    // An error leaves the part without an image; the next follow-up run tries again.
    const r = await versuche(
      'bild-nachlauf:downloadImage',
      enrich.downloadImage(kx, p.image_url, p.part_number, p.color_id ?? NO_COLOR, 'part'),
    );
    const local = r.ok ? r.wert : null;
    if (local) {
      // Once into the catalog for all accounts. A write error aborts the run as with
      // the figures; the next one finds the file and writes it afterwards.
      await setPartImageLocal(kx, p.part_number, p.color_id ?? NO_COLOR, local);
      // Trigger the preview right away, otherwise it would stay at the original size
      // until the next restart.
      kx.images.createPreview(local).catch(logAndContinue('bild-nachlauf:vorschauErzeugenAus'));
    }
    await tick();
  }
  for (const f of figsToFetch) {
    const r = await versuche(
      'bild-nachlauf:downloadImage',
      enrich.downloadImage(kx, f.image_url, f.fig_number, 0, 'minifig'),
    );
    const local = r.ok ? r.wert : null;
    if (local) {
      // One row: since migration 0034 the catalog lists the figure exactly once. A
      // write error aborts the run; the next one finds the file and writes it afterwards.
      await setMinifigImageLocal(kx, f.fig_number, local);
      kx.images.createPreview(local).catch(logAndContinue('bild-nachlauf:vorschauErzeugenAus'));
    }
    await tick();
  }
  await k.fortschritt({ erledigt: total, gesamt: total, text: 'Alle Bilder gecacht' });
}

export { imageFollowUp as bildNachlauf };
