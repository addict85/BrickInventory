import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import PDFDocument from 'pdfkit';
import { IMAGES_DIR, resolveWebPath } from '../../infra/appPaths';
import { reportError } from '../../infra/error';
import type { Payload } from '../../jobQueue';

/** In a worker_thread: pdfkit draws synchronously and with thousands of rows would stall
 * the event loop, which in the "beides" process also answers requests. */

export type PdfTeil = Payload<'pdf'>['parts'][number];
export type PdfSet = Payload<'pdf'>['sets'][number];

/** Only inside the image folder: the list comes from the client, an `image_local`
 * like `/images/../../…` would otherwise read foreign files into the PDF. */
function pdfImagePath(p: PdfTeil): string | null {
  let src = p.image_local || p.image_url || '';
  const m = src.match(/\/api\/img-proxy\?url=(.+)/);
  if (m) {
    try {
      src = decodeURIComponent(m[1] ?? '');
    } catch {
      return null;
    }
  }
  const raw = resolveWebPath(src);
  if (!raw) return null;
  const full = path.resolve(raw);
  return full.startsWith(path.resolve(IMAGES_DIR) + path.sep) ? full : null;
}

/** If an image is missing, the row stands without an image — the PDF is created anyway. */
const withoutImage = (): null => null;

/** One row per BrickLink number and color, grouped by color and sorted by number. */
function afterColor(parts: PdfTeil[]) {
  const deduped = new Map<string, PdfTeil & { quantity: number }>();
  for (const p of parts) {
    const blNum = p.bl_part_number || p.part_number;
    const key = `${blNum}|${p.color_id || p.color_name || 0}`;
    const alt = deduped.get(key);
    if (alt) alt.quantity += Number(p.quantity) || 0;
    else deduped.set(key, { ...p, part_number: blNum, quantity: Number(p.quantity) || 0 });
  }

  const colorOrder: string[] = [],
    byColor = new Map<string, (PdfTeil & { quantity: number })[]>();
  for (const p of deduped.values()) {
    const name = p.color_name ?? '';
    if (!byColor.has(name)) {
      byColor.set(name, []);
      colorOrder.push(name);
    }
    byColor.get(name)!.push(p);
  }
  colorOrder.sort((a, b) => a.localeCompare(b, 'de'));
  for (const list of byColor.values()) {
    list.sort((a, b) =>
      (a.bl_part_number || a.part_number || '').localeCompare(b.bl_part_number || b.part_number || '', undefined, {
        numeric: true,
      }),
    );
  }
  return { colorOrder, byColor };
}

type Doc = InstanceType<typeof PDFDocument>;
type Row = PdfTeil & { quantity: number };
const PAGE_H = 841.89,
  PAGE_W = 595.28;
const COL = { num: 40, name: 200 };
const START_X = 40;

/** As a stream, not as a buffer: a large collection results in many megabytes.
 * Only the finished file gets its name. */
async function buildPdf(sets: PdfSet[], parts: PdfTeil[], target: string): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const teil = `${target}.teil`;
  const file = fs.createWriteStream(teil);
  doc.pipe(file);
  const pdfDone = new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
    doc.on('error', reject);
  });

  const seiten = pagesLead(doc);
  drawHeader(doc, sets, parts);

  const { colorOrder, byColor } = afterColor(parts);
  // Preload and release per color group: only one group is held in memory.
  const images = new Map<string, Buffer | null>();
  for (const colorName of colorOrder) {
    const colorParts = byColor.get(colorName) ?? [];
    await loadImages(colorParts, images);
    drawColorGroup(doc, colorName, colorParts, images, seiten.newPage);
  }

  seiten.footer();
  doc.end();
  await pdfDone;
  await fsp.rename(teil, target);
}

/** Page number at the bottom center; the margin is lifted briefly for it, otherwise pdfkit wraps. */
function pagesLead(doc: Doc) {
  let page = 1;
  const footer = () => {
    const savedY = doc.y,
      savedX = doc.x,
      savedSize = (doc as unknown as { _fontSize: number })._fontSize;
    const origMargins = doc.page.margins;
    doc.page.margins = { top: 40, left: 40, bottom: 0, right: 40 };
    doc
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(`Seite ${page}`, 0, PAGE_H - 28, { width: PAGE_W, align: 'center', lineBreak: false });
    doc.page.margins = origMargins;
    doc.y = savedY;
    doc.x = savedX;
    doc.fontSize(savedSize).fillColor('#1e293b');
  };
  const newPage = () => {
    footer();
    page++;
    doc.addPage();
    doc.y = 40;
  };
  return { footer, newPage };
}

function drawHeader(doc: Doc, sets: PdfSet[], parts: PdfTeil[]) {
  doc.fontSize(18).font('Helvetica-Bold').text('Bauliste', { align: 'left' });
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#64748b')
    .text(`Sets: ${sets.map(s => s.set_number).join(', ')}`, { align: 'left' });
  doc.moveDown(0.5);
  const totalQty = parts.reduce((s, p) => s + (parseInt(String(p.quantity), 10) || 0), 0);
  doc.fontSize(9).fillColor('#64748b').text(`${parts.length} Teiletypen · ${totalQty.toLocaleString()} Teile total`);
  doc.moveDown(1);
}

async function loadImages(group: PdfTeil[], images: Map<string, Buffer | null>) {
  images.clear();
  const paths = [...new Set(group.map(pdfImagePath).filter((fp): fp is string => !!fp))];
  for (let i = 0; i < paths.length; i += 32) {
    const piece = paths.slice(i, i + 32);
    const bufs = await Promise.all(piece.map(fp => fsp.readFile(fp).catch(withoutImage)));
    piece.forEach((fp, j) => {
      images.set(fp, bufs[j] ?? null);
    });
  }
}

function drawColorGroup(
  doc: Doc,
  colorName: string,
  colorParts: Row[],
  images: Map<string, Buffer | null>,
  newPage: () => void,
) {
  if (doc.y > 700) newPage();

  const hexColor = colorParts[0]?.color_hex ? '#' + colorParts[0].color_hex : '#94a3b8';
  const dotX = 40,
    dotY = doc.y + 3;
  doc
    .circle(dotX + 5, dotY + 5, 5)
    .fill(hexColor)
    .fillColor('#1e293b');
  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .fillColor('#1e293b')
    .text(colorName || '(Keine Farbe)', dotX + 14, dotY, { continued: false });
  doc.moveDown(0.2);

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b');
  doc.text('Nummer', START_X, doc.y, { width: COL.num + 80, continued: false });
  const hy = doc.y - doc.currentLineHeight();
  doc.text('Bezeichnung', START_X + COL.num + 80, hy, { width: COL.name, continued: false });
  doc.text('Anz.', START_X + COL.num + 80 + COL.name, hy, { width: 50, align: 'right', continued: false });
  doc.moveDown(0.1);
  doc.moveTo(START_X, doc.y).lineTo(555, doc.y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.2);

  for (const p of colorParts) drawPart(doc, p, images, newPage);
  doc.moveDown(0.6);
}

function drawPart(doc: Doc, p: Row, images: Map<string, Buffer | null>, newPage: () => void) {
  const rowHeight = 36;
  if (doc.y > 730 - rowHeight) newPage();
  const rowY = doc.y;
  const fp = pdfImagePath(p);
  const imgBuf = fp ? images.get(fp) || null : null;
  let imgOffset = 0;
  if (imgBuf) {
    try {
      doc.image(imgBuf, START_X, rowY, { width: 30, height: 30, fit: [30, 30] });
      imgOffset = 36;
    } catch (e) {
      // Exception: an image pdfkit cannot read is dropped; the row stays.
      reportError(`pdf:teilbild ${p.part_number}`, e);
    }
  }
  doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
  doc.text(p.bl_part_number || p.part_number, START_X + imgOffset, rowY, { width: COL.num + 60 });
  doc.text(p.part_name ?? '', START_X + imgOffset + COL.num + 60, rowY, { width: COL.name - imgOffset });
  doc.font('Helvetica-Bold').text(String(p.quantity), START_X + imgOffset + COL.num + 60 + COL.name - imgOffset, rowY, {
    width: 50,
    align: 'right',
  });
  doc.y = rowY + rowHeight + 2;
}

type ThreadJob = { kind: 'pdf-zeichnen'; sets: PdfSet[]; parts: PdfTeil[]; target: string };

/** From the TypeScript sources (tsx) there is no .js file for the thread; then drawing happens here. */
function drawPdfInThread(sets: PdfSet[], parts: PdfTeil[], target: string): Promise<void> {
  if (__filename.endsWith('.ts')) return buildPdf(sets, parts, target);
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { kind: 'pdf-zeichnen', sets, parts, target } satisfies ThreadJob });
    w.once('message', (m: { ok: boolean; error?: string }) => (m.ok ? resolve() : reject(new Error(m.error))));
    w.once('error', reject);
    w.once('exit', code => {
      if (code !== 0) reject(new Error(`PDF-Faden endete mit ${code}`));
    });
  });
}

if (!isMainThread && parentPort && (workerData as ThreadJob | undefined)?.kind === 'pdf-zeichnen') {
  const { sets, parts, target } = workerData as ThreadJob;
  const port = parentPort;
  buildPdf(sets, parts, target).then(
    () => port.postMessage({ ok: true }),
    (e: unknown) => port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
}

export { pdfImagePath, buildPdf, drawPdfInThread };
