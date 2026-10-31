import fsp from 'fs/promises';
import path from 'path';
import * as db from '../db/database';
import { MINIFIG_IMAGES_DIR } from '../src/infra/appPaths';
import { getMinifigInfo } from '../clients/rebrickable';
import { logAndContinue, meldeUndWeiter } from '../src/infra/httpError';
import { pdfDateiPfad } from '../src/auftraege/pdfAuftraege';
import { downloadImage, downloadSetImages } from './partsCatalogEnrich';
import { zeichnePdfImFaden, type PdfSet, type PdfTeil } from './pdfZeichnen';
import { KEINE_FARBE } from '../src/infra/validate';
import { merkeFigurBildAdresse, setzeFigurBildLokal, setzeTeilBildLokal } from '../src/katalog/katalogPflege';
import { normalisiereSetNummer, moeglicheSetNummer } from '../src/sets/setNummer';

/**
 * Ein PDF-Auftrag aus der Auftragstabelle: fehlende Bilder holen, dann im
 * eigenen Faden zeichnen. Den Status für die Oberfläche liest
 * src/auftraege/pdfAuftraege.ts aus demselben Auftrag.
 */
export interface PdfNutzlast { job_id: string; user_id: number; sets: PdfSet[]; parts: PdfTeil[] }

const istFigur = (p: PdfTeil) => !!p.is_fig || String(p.part_number).startsWith('fig-');
/** Die CDN-Adresse hinter einer Proxy-Adresse. */
const cdnAdresse = (url: string) => {
  const roh = url.match(/\/api\/img-proxy\?url=(.+)/)?.[1];
  return roh ? decodeURIComponent(roh) : url;
};

/**
 * Bildquellen nur aus dem Katalog, und dort nur aus geprüfter Quelle
 * (bild_von IS NULL): Die Dateien im Bildordner gelten für alle Konten, ein
 * Bild vom Client oder ein eingetipptes landete sonst bei allen anderen.
 */
export async function bilderAusKatalog(parts: PdfTeil[]): Promise<void> {
  for (const p of parts) { p.image_url = null; p.image_local = null; }
  const teile = [...new Set(parts.filter(p => !istFigur(p)).map(p => String(p.part_number)))];
  if (teile.length) {
    const zeilen = await db.all<{ part_number: string; color_id: number; image_local: string | null; image_url: string | null }>(
      `SELECT part_number, color_id, image_local, CASE WHEN bild_von IS NULL THEN image_url END AS image_url
         FROM part_color_catalog WHERE part_number = ANY($1)`, [teile]);
    const m = new Map(zeilen.map(r => [`${r.part_number}|${r.color_id}`, r] as const));
    for (const p of parts.filter(p => !istFigur(p))) {
      const z = m.get(`${p.part_number}|${p.color_id ?? KEINE_FARBE}`);
      if (z) { p.image_local = z.image_local; p.image_url = z.image_url; }
    }
  }
  const figuren = [...new Set(parts.filter(istFigur).map(p => String(p.part_number)))];
  if (!figuren.length) return;
  const zeilen = await db.all<{ fig_number: string; image_local: string | null; image_url: string | null }>(
    `SELECT fig_number, image_local, CASE WHEN bild_von IS NULL THEN image_url END AS image_url
       FROM minifigs_catalog WHERE fig_number = ANY($1)`, [figuren]);
  const m = new Map(zeilen.map(r => [r.fig_number, r] as const));
  for (const p of parts.filter(istFigur)) {
    const z = m.get(String(p.part_number));
    if (z) { p.image_local = z.image_local; p.image_url = z.image_url; }
  }
}

async function figurenOhneAdresse(parts: PdfTeil[]) {
  for (const p of parts.filter(p => istFigur(p) && !p.image_url && !p.image_local && /^fig-\d{1,8}$/.test(p.part_number))) {
    try {
      const info = await getMinifigInfo(p.part_number);
      if (!info?.image_url) continue;
      p.image_url = info.image_url;
      await merkeFigurBildAdresse(p.part_number, info.image_url).catch(logAndContinue('pdf:figurbild merken'));
    } catch (e) { meldeUndWeiter('pdf:figurbild holen', e); }
  }
}

/** Figurenbilder lagen unter zwei Schreibweisen auf der Platte; die gefundene merken. */
async function figurenAufDerPlatte(parts: PdfTeil[]) {
  for (const p of parts.filter(p => istFigur(p) && !p.image_local && p.image_url)) {
    const cdn = cdnAdresse(p.image_url || '');
    const ext = ((cdn.split('.').pop() || '').split('?')[0] || 'jpg').substring(0, 4).toLowerCase();
    for (const name of [`${p.part_number.replace(/[^a-z0-9-]/gi, '_')}.${ext}`,
                        `${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`,
                        `fig_${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`]) {
      const da = await fsp.access(path.join(MINIFIG_IMAGES_DIR, name)).then(() => true, () => false);
      if (!da) continue;
      p.image_local = `/images/minifigs/${name}`;
      await setzeFigurBildLokal(p.part_number, p.image_local).catch(logAndContinue('pdf:figurbild pfad merken'));
      break;
    }
  }
}

async function erzeugePdf(n: PdfNutzlast): Promise<void> {
  const { job_id: jobId, user_id: uid, sets = [], parts = [] } = n;
  const ziel = pdfDateiPfad(jobId);
  if (!ziel) throw new Error(`ungültige Auftragskennung ${jobId}`);
  const setNumbers = [...new Set(sets.map(s => normalisiereSetNummer(s?.set_number ?? '')).filter(moeglicheSetNummer))];
  // Warten, falls ein anderer Prozess dieselben Bilder lädt — sonst fehlten sie im PDF.
  for (const sn of setNumbers) await downloadSetImages(sn, true).catch(logAndContinue(`pdf:bilder ${sn}`));
  await bilderAusKatalog(parts);
  await figurenOhneAdresse(parts);
  await figurenAufDerPlatte(parts);
  // Was dann noch fehlt (Teil nicht im Set-Katalog, abweichende Farbe), einzeln.
  for (const p of parts.filter(p => !p.image_local && p.image_url)) {
    const figur = istFigur(p);
    const lokal = await downloadImage(cdnAdresse(p.image_url!), p.part_number, figur ? 0 : (p.color_id ?? KEINE_FARBE),
      figur ? 'minifig' : 'part').catch(logAndContinue(`pdf:bild ${p.part_number}`));
    if (!lokal) continue;
    p.image_local = lokal;
    await (figur ? setzeFigurBildLokal(p.part_number, lokal) : setzeTeilBildLokal(p.part_number, p.color_id ?? KEINE_FARBE, lokal))
      .catch(logAndContinue(`pdf:bildpfad ${p.part_number}`));
  }
  const mitBild = parts.filter(p => p.image_local).length;
  if (mitBild < parts.length) console.log(`[PDF job] ${jobId}: ${mitBild}/${parts.length} Bilder vorhanden`);

  await fsp.mkdir(path.dirname(ziel), { recursive: true });
  await zeichnePdfImFaden(sets, parts, ziel);
  console.log(`[PDF job] ${jobId} fertig für Konto ${uid}`);
}

/** Nach dem letzten Versuch; den Fehler für die Oberfläche hält der Auftrag selbst. */
async function pdfAufgegeben(n: PdfNutzlast, fehler: string): Promise<void> {
  console.error(`[PDF job] ${n.job_id} error:`, fehler);
}

export { erzeugePdf, pdfAufgegeben };
