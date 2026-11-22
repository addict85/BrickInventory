/** Read a voucher PDF in a worker thread: every page costs its own document, which
 * should not stall the web process for everyone. Too many pages are rejected first. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { PDFDocument as PdfLibDocument } from '@cantoo/pdf-lib';
import { valuesFromPdf, PdfTooLarge, type ParsedVoucher } from './pdfParsing';
import { pagesOrNone } from './pdfExport';

/** A LEGO bundle PDF has one page per voucher; 200 is far more than anyone buys at once. */
export const MAX_PAGES = 200;
const TIMEOUT_MS = 30_000;

export type PdfReadResult =
  | { art: 'zu_viele_seiten'; seiten: number }
  | { art: 'unlesbar' }
  | { art: 'gelesen'; seiten: number; stapel: ParsedVoucher[]; einzeln: ParsedVoucher | 'zu_gross' | 'fehler' };

export async function readUploadedPdf(data: Buffer): Promise<PdfReadResult> {
  let pages: number;
  try {
    pages = (await PdfLibDocument.load(data, { updateMetadata: false })).getPageCount();
  } catch {
    pages = 1;
  } // What pdf-lib cannot load, valuesFromPdf still reads as text.
  if (pages > MAX_PAGES) return { art: 'zu_viele_seiten', seiten: pages };
  const stapel = await pagesOrNone(data);
  let einzeln: ParsedVoucher | 'zu_gross' | 'fehler';
  try {
    einzeln = valuesFromPdf(data);
  } catch (e) {
    einzeln = e instanceof PdfTooLarge ? 'zu_gross' : 'fehler';
  }
  return { art: 'gelesen', seiten: pages, stapel, einzeln };
}

/** In a worker; when the server runs from sources (tsx) there is no .js and it stays in-process. */
export function readInBackground(data: Buffer): Promise<PdfReadResult> {
  if (!__filename.endsWith('.js')) return readUploadedPdf(data);
  return new Promise(done => {
    const w = new Worker(__filename, {
      workerData: { voucherPdf: data },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => {
      void w.terminate();
    }, TIMEOUT_MS);
    let result: PdfReadResult = { art: 'unlesbar' };
    w.once('message', (m: PdfReadResult) => {
      result = m;
    });
    w.once('error', () => {
      result = { art: 'unlesbar' };
    });
    w.once('exit', () => {
      clearTimeout(timer);
      done(result);
    });
  });
}

if (!isMainThread && (workerData as { voucherPdf?: Uint8Array } | null)?.voucherPdf) {
  const raw = (workerData as { voucherPdf: Uint8Array }).voucherPdf;
  void readUploadedPdf(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)).then(
    r => parentPort!.postMessage(r),
    () => parentPort!.postMessage({ art: 'unlesbar' }),
  );
}
