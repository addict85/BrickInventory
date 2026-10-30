import path from 'path';
import fsp from 'fs/promises';
import fs from 'fs';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import PDFDocument from 'pdfkit';
import { IMAGES_DIR, resolveWebPath } from '../utils/appPaths';

/**
 * Die Teileliste als PDF zeichnen. pdfkit zeichnet synchron; bei tausenden
 * Zeilen hielte das die Ereignisschleife des Prozesses sekundenlang an, und
 * im Prozess „beides“ beantwortet derselbe Prozess auch Anfragen. Darum läuft es in einem
 * worker_thread: Er braucht keine Datenbank, nur die Liste und die Bilddateien.
 */

/** Eine Zeile der Teileliste, soweit das PDF sie liest. */
export type PdfTeil = {
  part_number: string;
  bl_part_number?: string | null;
  part_name?: string | null;
  color_id?: number | null;
  color_name?: string | null;
  color_hex?: string | null;
  quantity?: number | string | null;
  is_fig?: boolean | number | null;
  image_url?: string | null;
  image_local?: string | null;
};
export type PdfSet = { set_number: string };

/**
 * Die Bilddatei eines Teils auf der Platte, nur innerhalb des Bildordners.
 * Die Teileliste kommt vom Client; ein `image_local` wie `/data/uploads/7/…`
 * oder `/images/../../…` läse sonst fremde Dateien ins PDF.
 */
function pdfBildPfad(p: PdfTeil): string | null {
  let src = p.image_local || p.image_url || '';
  const m = src.match(/\/api\/img-proxy\?url=(.+)/);
  if (m) { try { src = decodeURIComponent(m[1] ?? ''); } catch { return null; } }
  const roh = resolveWebPath(src);
  if (!roh) return null;
  const voll = path.resolve(roh);
  return voll.startsWith(path.resolve(IMAGES_DIR) + path.sep) ? voll : null;
}

/** Fehlt ein Bild oder ist es kaputt, steht die Zeile ohne Bild da — das PDF entsteht trotzdem. */
const ohneBild = (): null => null;

/**
 * Das PDF als Strom in die Datei — nicht als Puffer: Eine grosse Sammlung
 * ergibt viele Megabyte. Erst die fertige Datei bekommt ihren Namen.
 */
async function buildPdf(sets: PdfSet[], parts: PdfTeil[], ziel: string): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const teil = `${ziel}.teil`;
  const datei = fs.createWriteStream(teil);
  doc.pipe(datei);
  const pdfDone = new Promise((resolve, reject) => {
    datei.on('finish', resolve); datei.on('error', reject); doc.on('error', reject); });

  let seite = 1;
  const PAGE_H = 841.89, PAGE_W = 595.28;
  function addFooter() {
    const savedY = doc.y, savedX = doc.x, savedSize = (doc as unknown as { _fontSize: number })._fontSize;
    const origMargins = doc.page.margins;
    doc.page.margins = { top: 40, left: 40, bottom: 0, right: 40 };
    doc.fontSize(8).fillColor('#94a3b8').text(`Seite ${seite}`, 0, PAGE_H - 28, { width: PAGE_W, align: 'center', lineBreak: false });
    doc.page.margins = origMargins;
    doc.y = savedY; doc.x = savedX; doc.fontSize(savedSize).fillColor("#1e293b");
  }
  function newPage() { addFooter(); seite++; doc.addPage(); doc.y = 40; }

  doc.fontSize(18).font('Helvetica-Bold').text('Teileliste', { align: 'left' });
  doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(`Sets: ${sets.map(s => s.set_number).join(', ')}`, { align: 'left' });
  doc.moveDown(0.5);
  const totalQty = parts.reduce((s, p) => s + (parseInt(String(p.quantity)) || 0), 0);
  doc.fontSize(9).fillColor('#64748b').text(`${parts.length} Teiletypen · ${totalQty.toLocaleString()} Teile total`);
  doc.moveDown(1);

  const deduped = new Map<string, PdfTeil & { quantity: number }>();
  for (const p of parts) {
    const blNum = p.bl_part_number || p.part_number;
    const key = `${blNum}|${p.color_id || p.color_name || 0}`;
    const alt = deduped.get(key);
    if (alt) alt.quantity += Number(p.quantity) || 0;
    else deduped.set(key, { ...p, part_number: blNum, quantity: Number(p.quantity) || 0 });
  }

  const colorOrder: string[] = [], byColor = new Map<string, (PdfTeil & { quantity: number })[]>();
  for (const p of deduped.values()) {
    const name = p.color_name ?? '';
    if (!byColor.has(name)) { byColor.set(name, []); colorOrder.push(name); }
    byColor.get(name)!.push(p);
  }
  colorOrder.sort((a, b) => a.localeCompare(b, 'de'));
  for (const liste of byColor.values()) {
    liste.sort((a, b) => (a.bl_part_number || a.part_number || '').localeCompare(b.bl_part_number || b.part_number || '', undefined, { numeric: true }));
  }

  // Bilder je Farbgruppe vorladen und wieder freigeben: Im Speicher liegt nur
  // eine Gruppe, nicht die ganze Sammlung.
  const bilder = new Map<string, Buffer | null>();
  const ladeBilder = async (gruppe: PdfTeil[]) => {
    bilder.clear();
    const pfade = [...new Set(gruppe.map(pdfBildPfad).filter((fp): fp is string => !!fp))];
    for (let i = 0; i < pfade.length; i += 32) {
      const stueck = pfade.slice(i, i + 32);
      const bufs = await Promise.all(stueck.map(fp => fsp.readFile(fp).catch(ohneBild)));
      stueck.forEach((fp, j) => bilder.set(fp, bufs[j] ?? null));
    }
  };

  const COL = { num: 40, name: 200 };
  for (const colorName of colorOrder) {
    const colorParts = byColor.get(colorName) ?? [];
    await ladeBilder(colorParts);
    if (doc.y > 700) newPage();

    const hexColor = colorParts[0]?.color_hex ? '#' + colorParts[0].color_hex : '#94a3b8';
    const dotX = 40, dotY = doc.y + 3;
    doc.circle(dotX + 5, dotY + 5, 5).fill(hexColor).fillColor('#1e293b');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(colorName || '(Keine Farbe)', dotX + 14, dotY, { continued: false });
    doc.moveDown(0.2);

    const startX = 40;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b');
    doc.text('Nummer', startX, doc.y, { width: COL.num + 80, continued: false });
    const hy = doc.y - doc.currentLineHeight();
    doc.text('Bezeichnung', startX + COL.num + 80, hy, { width: COL.name, continued: false });
    doc.text('Anz.', startX + COL.num + 80 + COL.name, hy, { width: 50, align: 'right', continued: false });
    doc.moveDown(0.1);
    doc.moveTo(startX, doc.y).lineTo(555, doc.y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.2);

    for (const p of colorParts) {
      const rowHeight = 36;
      if (doc.y > 730 - rowHeight) newPage();
      const rowY = doc.y;
      const fp = pdfBildPfad(p);
      const imgBuf = fp ? (bilder.get(fp) || null) : null;
      let imgOffset = 0;
      if (imgBuf) {
        // Ein Bild, das pdfkit nicht lesen kann (kein PNG/JPEG), fällt weg; die Zeile bleibt.
        try { doc.image(imgBuf, startX, rowY, { width: 30, height: 30, fit: [30, 30] }); imgOffset = 36; }
        catch (e) { console.warn(`[PDF] Bild für ${p.part_number} unlesbar: ${(e as Error).message}`); }
      }
      doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
      doc.text(p.bl_part_number || p.part_number, startX + imgOffset, rowY, { width: COL.num + 60 });
      doc.text(p.part_name ?? '', startX + imgOffset + COL.num + 60, rowY, { width: COL.name - imgOffset });
      doc.font('Helvetica-Bold').text(String(p.quantity), startX + imgOffset + COL.num + 60 + COL.name - imgOffset, rowY, { width: 50, align: 'right' });
      doc.y = rowY + rowHeight + 2;
    }
    doc.moveDown(0.6);
  }

  addFooter();
  doc.end();
  await pdfDone;
  await fsp.rename(teil, ziel);
}

type FadenAuftrag = { art: 'pdf-zeichnen'; sets: PdfSet[]; parts: PdfTeil[]; ziel: string };

/**
 * buildPdf() in einem eigenen Faden. Aus den TypeScript-Quellen (Entwicklung
 * mit tsx) gibt es keine .js-Datei für den Faden; dann wird hier gezeichnet.
 */
function zeichnePdfImFaden(sets: PdfSet[], parts: PdfTeil[], ziel: string): Promise<void> {
  if (__filename.endsWith('.ts')) return buildPdf(sets, parts, ziel);
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { art: 'pdf-zeichnen', sets, parts, ziel } satisfies FadenAuftrag });
    w.once('message', (m: { ok: boolean; fehler?: string }) => m.ok ? resolve() : reject(new Error(m.fehler)));
    w.once('error', reject);
    w.once('exit', code => { if (code !== 0) reject(new Error(`PDF-Faden endete mit ${code}`)); });
  });
}

if (!isMainThread && parentPort && (workerData as FadenAuftrag | undefined)?.art === 'pdf-zeichnen') {
  const { sets, parts, ziel } = workerData as FadenAuftrag;
  const port = parentPort;
  buildPdf(sets, parts, ziel).then(
    () => port.postMessage({ ok: true }),
    (e: unknown) => port.postMessage({ ok: false, fehler: e instanceof Error ? e.message : String(e) }));
}

export { pdfBildPfad, buildPdf, zeichnePdfImFaden };
