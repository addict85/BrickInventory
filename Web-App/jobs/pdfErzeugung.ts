import fsp from 'fs/promises';
import path from 'path';
import * as db from '../db/database';
import { MINIFIG_IMAGES_DIR } from '../utils/appPaths';
import { getMinifigInfo } from '../clients/rebrickable';
import { logAndContinue, meldeUndWeiter } from '../utils/httpError';
import { schreibeAuftrag, pdfDateiPfad } from '../utils/pdfAuftraege';
import { downloadImage, downloadSetImages } from './partsCatalogEnrich';
import { zeichnePdfImFaden, type PdfSet, type PdfTeil } from './pdfZeichnen';

/**
 * Ein PDF-Auftrag aus der Auftragstabelle: fehlende Bilder holen, dann im
 * eigenen Faden zeichnen. Der Status für die Oberfläche steht weiter in
 * pdf_auftraege (utils/pdfAuftraege.ts).
 */
export interface PdfNutzlast { job_id: string; user_id: number; sets: PdfSet[]; parts: PdfTeil[] }

const istFigur = (p: PdfTeil) => !!p.is_fig || String(p.part_number).startsWith('fig-');
/** Die CDN-Adresse hinter einer Proxy-Adresse. */
const cdnAdresse = (url: string) => {
  const roh = url.match(/\/api\/img-proxy\?url=(.+)/)?.[1];
  return roh ? decodeURIComponent(roh) : url;
};

async function figurenOhneAdresse(parts: PdfTeil[]) {
  for (const p of parts.filter(p => istFigur(p) && !p.image_url && !p.image_local)) {
    try {
      const info = await getMinifigInfo(p.part_number);
      if (!info?.image_url) continue;
      p.image_url = info.image_url;
      await db.run(`UPDATE set_minifigs_catalog SET image_url=$1 WHERE fig_number=$2 AND image_url IS NULL`,
        [info.image_url, p.part_number]).catch(logAndContinue('pdf:figurbild merken'));
    } catch (e) { meldeUndWeiter('pdf:figurbild holen', e); }
  }
}

async function bilderAusKatalog(parts: PdfTeil[]) {
  const teile = [...new Set(parts.filter(p => !istFigur(p)).map(p => p.part_number))];
  if (teile.length) {
    const frisch = await db.all(
      `SELECT part_number, color_id, image_local FROM set_parts_catalog
        WHERE part_number = ANY($1) AND image_local IS NOT NULL`, [teile]);
    const m = new Map<string, string>(frisch.map(r => [`${r.part_number}|${r.color_id}`, r.image_local] as [string, string]));
    for (const p of parts) if (!istFigur(p) && m.has(`${p.part_number}|${p.color_id || 0}`)) p.image_local = m.get(`${p.part_number}|${p.color_id || 0}`)!;
  }
  const figuren = [...new Set(parts.filter(istFigur).map(p => p.part_number))];
  if (!figuren.length) return;
  const frisch = await db.all(
    `SELECT fig_number, image_local FROM set_minifigs_catalog
      WHERE fig_number = ANY($1) AND image_local IS NOT NULL`, [figuren]);
  const m = new Map<string, string>(frisch.map(r => [r.fig_number, r.image_local] as [string, string]));
  for (const p of parts.filter(istFigur)) {
    if (m.has(p.part_number)) { p.image_local = m.get(p.part_number)!; continue; }
    if (p.image_local) continue;
    // Auf der Platte nachsehen: Figurenbilder lagen unter zwei Schreibweisen.
    const cdn = cdnAdresse(p.image_url || '');
    const ext = ((cdn.split('.').pop() || '').split('?')[0] || 'jpg').substring(0, 4).toLowerCase();
    for (const name of [`${p.part_number.replace(/[^a-z0-9-]/gi, '_')}.${ext}`,
                        `${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`,
                        `fig_${p.part_number.replace(/[^a-z0-9]/gi, '_')}.${ext}`]) {
      const da = await fsp.access(path.join(MINIFIG_IMAGES_DIR, name)).then(() => true, () => false);
      if (!da) continue;
      p.image_local = `/images/minifigs/${name}`;
      await db.run(`UPDATE set_minifigs_catalog SET image_local=$1 WHERE fig_number=$2`, [p.image_local, p.part_number])
        .catch(logAndContinue('pdf:figurbild pfad merken'));
      break;
    }
  }
}

async function erzeugePdf(n: PdfNutzlast): Promise<void> {
  const { job_id: jobId, user_id: uid, sets = [], parts = [] } = n;
  const ziel = pdfDateiPfad(jobId);
  if (!ziel) throw new Error(`ungültige Auftragskennung ${jobId}`);
  const setNumbers = sets.map(s => s.set_number).filter(Boolean);
  if (setNumbers.length) {
    await figurenOhneAdresse(parts);
    // Warten, falls ein anderer Prozess dieselben Bilder lädt — sonst fehlten sie im PDF.
    for (const sn of setNumbers) await downloadSetImages(sn, true).catch(logAndContinue(`pdf:bilder ${sn}`));
    await bilderAusKatalog(parts);
  }
  // Was dann noch fehlt (Teil nicht im Set-Katalog, abweichende Farbe), einzeln.
  for (const p of parts.filter(p => !p.image_local && p.image_url)) {
    const cdn = cdnAdresse(p.image_url!);
    if (!/^https?:\/\//.test(cdn)) continue;
    const lokal = await downloadImage(cdn, p.part_number, p.color_id || 0, 'part').catch(logAndContinue(`pdf:bild ${p.part_number}`));
    if (lokal) p.image_local = lokal;
  }
  const mitBild = parts.filter(p => p.image_local).length;
  if (mitBild < parts.length) console.log(`[PDF job] ${jobId}: ${mitBild}/${parts.length} Bilder vorhanden`);

  await fsp.mkdir(path.dirname(ziel), { recursive: true });
  await zeichnePdfImFaden(sets, parts, ziel);
  await schreibeAuftrag(jobId, { status: 'done', error: null, user_id: uid });
}

/** Nach dem letzten Versuch: Die Oberfläche bekommt den Fehler statt eines ewigen „läuft". */
async function pdfAufgegeben(n: PdfNutzlast, fehler: string): Promise<void> {
  console.error('[PDF job] error:', fehler);
  await schreibeAuftrag(n.job_id, { status: 'error', error: fehler, user_id: n.user_id });
}

export { erzeugePdf, pdfAufgegeben };
