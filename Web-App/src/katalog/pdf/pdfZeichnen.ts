import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import PDFDocument from 'pdfkit';
import { IMAGES_DIR, resolveWebPath } from '../../infra/appPaths';
import { meldeFehler } from '../../infra/fehler';
import type { Nutzlast } from '../../auftraege';

/** Im worker_thread: pdfkit zeichnet synchron und hielte bei tausenden Zeilen
 * die Ereignisschleife an, die im Prozess „beides" auch Anfragen beantwortet. */

export type PdfTeil = Nutzlast<'pdf'>['parts'][number];
export type PdfSet = Nutzlast<'pdf'>['sets'][number];

/** Nur innerhalb des Bildordners: Die Liste kommt vom Client, ein `image_local`
 * wie `/images/../../…` läse sonst fremde Dateien ins PDF. */
function pdfBildPfad(p: PdfTeil): string | null {
  let src = p.image_local || p.image_url || '';
  const m = src.match(/\/api\/img-proxy\?url=(.+)/);
  if (m) {
    try {
      src = decodeURIComponent(m[1] ?? '');
    } catch {
      return null;
    }
  }
  const roh = resolveWebPath(src);
  if (!roh) return null;
  const voll = path.resolve(roh);
  return voll.startsWith(path.resolve(IMAGES_DIR) + path.sep) ? voll : null;
}

/** Fehlt ein Bild, steht die Zeile ohne Bild da — das PDF entsteht trotzdem. */
const ohneBild = (): null => null;

/** Je BrickLink-Nummer und Farbe eine Zeile, nach Farbe gruppiert und nach Nummer sortiert. */
function nachFarbe(parts: PdfTeil[]) {
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
  for (const liste of byColor.values()) {
    liste.sort((a, b) =>
      (a.bl_part_number || a.part_number || '').localeCompare(b.bl_part_number || b.part_number || '', undefined, {
        numeric: true,
      }),
    );
  }
  return { colorOrder, byColor };
}

type Doc = InstanceType<typeof PDFDocument>;
type Zeile = PdfTeil & { quantity: number };
const PAGE_H = 841.89,
  PAGE_W = 595.28;
const COL = { num: 40, name: 200 };
const START_X = 40;

/** Als Strom, nicht als Puffer: Eine grosse Sammlung ergibt viele Megabyte.
 * Erst die fertige Datei bekommt ihren Namen. */
async function buildPdf(sets: PdfSet[], parts: PdfTeil[], ziel: string): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const teil = `${ziel}.teil`;
  const datei = fs.createWriteStream(teil);
  doc.pipe(datei);
  const pdfDone = new Promise((resolve, reject) => {
    datei.on('finish', resolve);
    datei.on('error', reject);
    doc.on('error', reject);
  });

  const seiten = seitenFuehrung(doc);
  kopfZeichnen(doc, sets, parts);

  const { colorOrder, byColor } = nachFarbe(parts);
  // Je Farbgruppe vorladen und freigeben: Im Speicher liegt nur eine Gruppe.
  const bilder = new Map<string, Buffer | null>();
  for (const colorName of colorOrder) {
    const colorParts = byColor.get(colorName) ?? [];
    await ladeBilder(colorParts, bilder);
    farbGruppeZeichnen(doc, colorName, colorParts, bilder, seiten.neueSeite);
  }

  seiten.fusszeile();
  doc.end();
  await pdfDone;
  await fsp.rename(teil, ziel);
}

/** Seitenzahl unten mittig; der Rand wird dafür kurz aufgehoben, sonst bricht pdfkit um. */
function seitenFuehrung(doc: Doc) {
  let seite = 1;
  const fusszeile = () => {
    const savedY = doc.y,
      savedX = doc.x,
      savedSize = (doc as unknown as { _fontSize: number })._fontSize;
    const origMargins = doc.page.margins;
    doc.page.margins = { top: 40, left: 40, bottom: 0, right: 40 };
    doc
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(`Seite ${seite}`, 0, PAGE_H - 28, { width: PAGE_W, align: 'center', lineBreak: false });
    doc.page.margins = origMargins;
    doc.y = savedY;
    doc.x = savedX;
    doc.fontSize(savedSize).fillColor('#1e293b');
  };
  const neueSeite = () => {
    fusszeile();
    seite++;
    doc.addPage();
    doc.y = 40;
  };
  return { fusszeile, neueSeite };
}

function kopfZeichnen(doc: Doc, sets: PdfSet[], parts: PdfTeil[]) {
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

async function ladeBilder(gruppe: PdfTeil[], bilder: Map<string, Buffer | null>) {
  bilder.clear();
  const pfade = [...new Set(gruppe.map(pdfBildPfad).filter((fp): fp is string => !!fp))];
  for (let i = 0; i < pfade.length; i += 32) {
    const stueck = pfade.slice(i, i + 32);
    const bufs = await Promise.all(stueck.map(fp => fsp.readFile(fp).catch(ohneBild)));
    stueck.forEach((fp, j) => {
      bilder.set(fp, bufs[j] ?? null);
    });
  }
}

function farbGruppeZeichnen(
  doc: Doc,
  colorName: string,
  colorParts: Zeile[],
  bilder: Map<string, Buffer | null>,
  neueSeite: () => void,
) {
  if (doc.y > 700) neueSeite();

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

  for (const p of colorParts) teilZeichnen(doc, p, bilder, neueSeite);
  doc.moveDown(0.6);
}

function teilZeichnen(doc: Doc, p: Zeile, bilder: Map<string, Buffer | null>, neueSeite: () => void) {
  const rowHeight = 36;
  if (doc.y > 730 - rowHeight) neueSeite();
  const rowY = doc.y;
  const fp = pdfBildPfad(p);
  const imgBuf = fp ? bilder.get(fp) || null : null;
  let imgOffset = 0;
  if (imgBuf) {
    try {
      doc.image(imgBuf, START_X, rowY, { width: 30, height: 30, fit: [30, 30] });
      imgOffset = 36;
    } catch (e) {
      // Ausnahme: Ein Bild, das pdfkit nicht lesen kann, fällt weg; die Zeile bleibt.
      meldeFehler(`pdf:teilbild ${p.part_number}`, e);
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

type FadenAuftrag = { art: 'pdf-zeichnen'; sets: PdfSet[]; parts: PdfTeil[]; ziel: string };

/** Aus den TypeScript-Quellen (tsx) gibt es keine .js-Datei für den Faden; dann wird hier gezeichnet. */
function zeichnePdfImFaden(sets: PdfSet[], parts: PdfTeil[], ziel: string): Promise<void> {
  if (__filename.endsWith('.ts')) return buildPdf(sets, parts, ziel);
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { art: 'pdf-zeichnen', sets, parts, ziel } satisfies FadenAuftrag });
    w.once('message', (m: { ok: boolean; fehler?: string }) => (m.ok ? resolve() : reject(new Error(m.fehler))));
    w.once('error', reject);
    w.once('exit', code => {
      if (code !== 0) reject(new Error(`PDF-Faden endete mit ${code}`));
    });
  });
}

if (!isMainThread && parentPort && (workerData as FadenAuftrag | undefined)?.art === 'pdf-zeichnen') {
  const { sets, parts, ziel } = workerData as FadenAuftrag;
  const port = parentPort;
  buildPdf(sets, parts, ziel).then(
    () => port.postMessage({ ok: true }),
    (e: unknown) => port.postMessage({ ok: false, fehler: e instanceof Error ? e.message : String(e) }),
  );
}

export { pdfBildPfad, buildPdf, zeichnePdfImFaden };
