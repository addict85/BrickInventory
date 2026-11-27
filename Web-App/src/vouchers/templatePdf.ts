/** A voucher without an uploaded original is drawn into LEGO's own card layout, so every
 * voucher can be downloaded as a PDF. The template (assets/voucher-template.pdf) carries
 * no card data: number, PIN, amount and barcode are comment markers in its content stream. */
import fs from 'node:fs';
import path from 'node:path';
import {
  PDFDocument as PdfLibDocument,
  PDFRawStream,
  decodePDFRawStream,
  StandardFonts,
  type PDFFont,
} from '@cantoo/pdf-lib';
/** Part of the program, not of the data: found next to the code (src/ or dist/src/), so a
 * different APP_ROOT (data volume, tests) does not hide it. */
function findTemplate(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'assets', 'voucher-template.pdf');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('voucher template missing (assets/voucher-template.pdf)');
}

/** Centre line of the card's text column (35.138 + 525 / 2), measured on the original. */
const CENTER_X = 297.638;
const LINES = { amount: 462.655, number: 441.288, pin: 419.92 };
const BARCODE = { x: 180.638, y: 367.497, width: 234, height: 33.75 };

export interface TemplateVoucher {
  number: string;
  pin: string | null;
  amount: number;
  currency: string;
}

// Read per download: rare, and module-wide state is not allowed here (test/ratschen.test.js).
const templateBytes = (): Buffer => fs.readFileSync(findTemplate());

/** Same sentence and number format as on a real card, so readPageByPage reads it back. */
export function amountSentence(amount: number, currency: string): string {
  const value = amount
    .toLocaleString('de-CH', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 })
    .replace(/’/g, "'");
  return `Ihre LEGO-Geschenkkarte im Wert von ${value} ${currency}:`;
}

// Code 128 bar/space widths for symbol values 0–106 (106 = stop, 7 elements).
const PATTERNS = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 ' +
  '122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 ' +
  '321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 ' +
  '211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 ' +
  '213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 ' +
  '121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 ' +
  '241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 ' +
  '412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 ' +
  '211214 211232 2331112'
).split(' ');
const START_B = 104;
const START_C = 105;
const CODE_C = 99;
const STOP = 106;

/** Symbol values incl. start, check digit and stop. Digits use set C (two per symbol),
 * an odd leading digit goes through set B first; anything else stays in set B. */
export function code128Values(text: string): number[] {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('code128: printable ASCII only');
  const values: number[] = [];
  let rest = text;
  if (/^\d+$/.test(text) && text.length >= 2) {
    if (text.length % 2) {
      values.push(START_B, text.charCodeAt(0) - 32, CODE_C);
      rest = text.slice(1);
    } else values.push(START_C);
    for (let i = 0; i < rest.length; i += 2) values.push(Number(rest.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of rest) values.push(ch.charCodeAt(0) - 32);
  }
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return [...values, check, STOP];
}

/** Bars as module offsets and widths, starting with a bar. */
export function code128Bars(text: string): { bars: [number, number][]; modules: number } {
  const bars: [number, number][] = [];
  let pos = 0;
  for (const v of code128Values(text)) {
    [...(PATTERNS[v] ?? '')].forEach((w, i) => {
      if (i % 2 === 0) bars.push([pos, Number(w)]);
      pos += Number(w);
    });
  }
  return { bars, modules: pos };
}

const literal = (text: string) => '(' + text.replace(/([()\\])/g, '\\$1') + ')';
const num = (n: number) => n.toFixed(3);

function centredLine(font: PDFFont, resource: string, size: number, y: number, text: string): string {
  const x = CENTER_X - font.widthOfTextAtSize(text, size) / 2;
  return `BT ${num(x)} ${num(y)} Td /${resource} ${size} Tf  [${literal(text)}] TJ ET`;
}

function barcodeOps(number: string): string {
  const { bars, modules } = code128Bars(number);
  const module = Math.min(BARCODE.width / modules, 1.5);
  const left = BARCODE.x + (BARCODE.width - module * modules) / 2;
  const rects = bars.map(
    ([at, w]) => `${num(left + at * module)} ${num(BARCODE.y)} ${num(w * module)} ${num(BARCODE.height)} re`,
  );
  return `q 0 0 0 rg ${rects.join(' ')} f Q`;
}

/** One page in the template's layout; F2/F3 are its Helvetica-Bold/Helvetica (WinAnsi). */
export async function fillTemplate(g: TemplateVoucher): Promise<Buffer> {
  const doc = await PdfLibDocument.load(templateBytes());
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fill: Record<string, string> = {
    amount: centredLine(normal, 'F3', 14.4, LINES.amount, amountSentence(g.amount, g.currency)),
    number: centredLine(bold, 'F2', 14.4, LINES.number, g.number),
    pin: g.pin ? centredLine(normal, 'F3', 14.4, LINES.pin, `PIN: ${g.pin}`) : '',
    barcode: barcodeOps(g.number),
  };
  let filled = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const raw = Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
    if (!raw.includes('% voucher:number')) continue;
    const out = raw.replace(/% voucher:(amount|number|pin|barcode)/g, (_m, key: string) => {
      filled++;
      return fill[key] ?? '';
    });
    doc.context.assign(ref, doc.context.flateStream(Buffer.from(out, 'latin1')));
  }
  if (filled !== 4) throw new Error(`voucher template: ${filled} of 4 markers found`);
  return Buffer.from(await doc.save());
}
