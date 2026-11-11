/** Gutschein-PDF im Worker-Thread lesen: Jede Seite kostet ein eigenes Dokument, das soll
 * den Web-Prozess nicht für alle anhalten. Zu viele Seiten werden vorher abgewiesen. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { PDFDocument as PdfLibDocument } from '@cantoo/pdf-lib';
import { werteAusPdf, PdfZuGross, type GutscheinWerte } from './gutscheinPdf';
import { seitenOderKeine } from './gutscheinPdfSchreiben';

/** Ein Sammel-PDF von LEGO hat eine Seite je Gutschein; 200 sind weit mehr, als jemand auf einmal kauft. */
export const HOECHSTENS_SEITEN = 200;
const FRIST_MS = 30_000;

export type PdfLesung =
  | { art: 'zu_viele_seiten'; seiten: number }
  | { art: 'unlesbar' }
  | { art: 'gelesen'; seiten: number; stapel: GutscheinWerte[]; einzeln: GutscheinWerte | 'zu_gross' | 'fehler' };

export async function liesHochgeladenesPdf(daten: Buffer): Promise<PdfLesung> {
  let seiten: number;
  try { seiten = (await PdfLibDocument.load(daten, { updateMetadata: false })).getPageCount(); }
  catch { seiten = 1; }   // Was pdf-lib nicht lädt, liest werteAusPdf trotzdem als Text.
  if (seiten > HOECHSTENS_SEITEN) return { art: 'zu_viele_seiten', seiten };
  const stapel = await seitenOderKeine(daten);
  let einzeln: GutscheinWerte | 'zu_gross' | 'fehler';
  try { einzeln = werteAusPdf(daten); }
  catch (e) { einzeln = e instanceof PdfZuGross ? 'zu_gross' : 'fehler'; }
  return { art: 'gelesen', seiten, stapel, einzeln };
}

/** Im Worker; läuft der Server aus den Quellen (tsx), gibt es kein .js und es bleibt im Prozess. */
export function liesImHintergrund(daten: Buffer): Promise<PdfLesung> {
  if (!__filename.endsWith('.js')) return liesHochgeladenesPdf(daten);
  return new Promise((fertig) => {
    const w = new Worker(__filename, { workerData: { gutscheinPdf: daten },
                                       resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const uhr = setTimeout(() => { void w.terminate(); }, FRIST_MS);
    let ergebnis: PdfLesung = { art: 'unlesbar' };
    w.once('message', (m: PdfLesung) => { ergebnis = m; });
    w.once('error', () => { ergebnis = { art: 'unlesbar' }; });
    w.once('exit', () => { clearTimeout(uhr); fertig(ergebnis); });
  });
}

if (!isMainThread && (workerData as { gutscheinPdf?: Uint8Array } | null)?.gutscheinPdf) {
  const roh = (workerData as { gutscheinPdf: Uint8Array }).gutscheinPdf;
  void liesHochgeladenesPdf(Buffer.from(roh.buffer, roh.byteOffset, roh.byteLength))
    .then(r => parentPort!.postMessage(r), () => parentPort!.postMessage({ art: 'unlesbar' }));
}
