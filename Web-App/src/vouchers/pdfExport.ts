/** The amount is replaced IN the original, so the export looks like LEGO's own
 * card; if that cannot be done safely, the original stays unchanged. */
import {
  PDFDocument as PdfLibDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  type PDFPage,
  type PDFObject,
  StandardFonts,
  rgb,
} from '@cantoo/pdf-lib';
import { valuesFromPdf, pdfText, textOperators, type ParsedVoucher } from './pdfParsing';
import { meldeUndLiefere } from '../infra/fehler';

/** Only here does a literal ASCII string print what it says. Without /Encoding it
 * is a standard font with StandardEncoding — the same holds there. */
const SAFE_ENCODINGS = new Set(['WinAnsiEncoding', 'MacRomanEncoding', 'StandardEncoding', 'PDFDocEncoding']);

function asLiteral(text: string): string {
  return '(' + text.replace(/([()\\])/g, '\\$1') + ')';
}

/** Unknown means NO: a font that cannot be checked is left untouched. */
function fontIsSafe(doc: PdfLibDocument, resources: PDFDict | undefined, name: string): boolean {
  if (!resources) return false;
  const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) return false;
  const entry = fonts.get(PDFName.of(name));
  if (entry === undefined) return false;
  const font = doc.context.lookupMaybe(entry, PDFDict);
  if (!font) return false;

  const subtype = font.get(PDFName.of('Subtype'));
  // Type0 (CID) carries glyph numbers; a literal ASCII string has nothing to do with that.
  if (subtype !== undefined && String(subtype) === '/Type0') return false;

  const enc = font.get(PDFName.of('Encoding'));
  if (enc === undefined) return true; // standard font
  const raw = String(enc);
  if (!raw.startsWith('/')) return false; // dictionary with /Differences
  return SAFE_ENCODINGS.has(raw.slice(1));
}

/** Kerning of a TJ field is lost; the amount is still there in full. */
function replaceInStream(
  content: string,
  search: string,
  replace: string,
  safe: (font: string) => boolean,
): { out: string; hits: number; rejected: number } {
  let hits = 0,
    rejected = 0;
  // The ACTIVE font is the last `/Name <size> Tf` before the operator;
  // unknown means: leave it alone.
  const tfs = [...content.matchAll(/\bTf\b/g)].map(m => m.index ?? 0);
  const names = new Map<number, string>();
  for (const m of content.matchAll(/\/([^\s/<>\][(){}]+)\s+[\d.+-]+\s+Tf/g))
    names.set((m.index ?? 0) + m[0].length - 2, m[1] ?? '');
  let out = '',
    sofar = 0,
    n = 0;
  for (const t of textOperators(content)) {
    if (!t.text.includes(search)) continue;
    while (n < tfs.length && (tfs[n] ?? 0) < t.from) n++;
    const font = n > 0 ? names.get(tfs[n - 1] ?? -1) : undefined;
    if (font === undefined || !safe(font)) {
      rejected++;
      continue;
    }

    hits++;
    // TJ becomes Tj: a single argument is no longer an array.
    out +=
      content.slice(sofar, t.from) +
      asLiteral(t.text.split(search).join(replace)) +
      ' ' +
      (t.op === 'TJ' ? 'Tj' : t.op);
    sofar = t.to;
  }
  out += content.slice(sofar);
  return { out, hits, rejected };
}

function streamsOf(doc: PdfLibDocument, page: PDFPage): PDFRawStream[] {
  const c = page.node.Contents();
  if (c === undefined) return [];
  const list: unknown[] = c instanceof PDFArray ? c.asArray().map((r: PDFObject) => doc.context.lookup(r)) : [c];
  return list.filter((s): s is PDFRawStream => s instanceof PDFRawStream);
}

export interface ReplaceResult {
  /** null if it could not be replaced safely. */
  data: Buffer | null;
  hits: number;
  /** Carried the amount, but with an unsafe font. */
  rejected: number;
  grund: string | null;
}

export async function replaceAmount(data: Buffer, newAmount: number): Promise<ReplaceResult> {
  const before = valuesFromPdf(data);
  if (before.amount === null) {
    return { data: null, hits: 0, rejected: 0, grund: 'No amount found in the PDF' };
  }
  // Nothing to do is success: the original already matches.
  if (Math.abs(before.amount - newAmount) < 0.005) {
    return { data, hits: 0, rejected: 0, grund: null };
  }

  // Looking for how the amount is WRITTEN ("1'234.50", "1.234,50"),
  // because that is what is in the stream.
  const text = pdfText(data);
  const written =
    text.match(/[\d'’.,]{1,30}(?=\s{0,9}(?:CHF|EUR|USD|GBP|SEK|NOK|AUD|CAD|DKK)\b)/i)?.[0] ?? String(before.amount);
  const newWritten = newAmount
    .toLocaleString('de-CH', {
      minimumFractionDigits: Number.isInteger(newAmount) ? 0 : 2,
      maximumFractionDigits: 2,
    })
    .replace(/’/g, "'");

  const doc = await PdfLibDocument.load(data);
  let hits = 0,
    rejected = 0;
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const safe = (name: string) => fontIsSafe(doc, resources, name);
    for (const stream of streamsOf(doc, page)) {
      let raw: Uint8Array;
      try {
        raw = decodePDFRawStream(stream).decode();
      } catch {
        continue;
      }
      const content = Buffer.from(raw).toString('latin1');
      const r = replaceInStream(content, written, newWritten, safe);
      hits += r.hits;
      rejected += r.rejected;
      if (!r.hits) continue;
      stream.contents = Buffer.from(r.out, 'latin1');
      stream.dict.set(PDFName.of('Length'), doc.context.obj(stream.contents.length));
      // The stream now sits UNCOMPRESSED; with /Filter, every reader would try
      // to unpack plain text.
      stream.dict.delete(PDFName.of('Filter'));
      stream.dict.delete(PDFName.of('DecodeParms'));
    }
  }

  if (!hits) {
    return {
      data: null,
      hits: 0,
      rejected,
      grund: rejected
        ? `The amount is in a font with its own encoding (${rejected}×) — ` +
          'a replaced string would print there as mangled characters'
        : `The notation "${written}" was not found in the content stream`,
    };
  }

  const result = Buffer.from(await doc.save());

  // Verify afterwards: only what the reader finds counts as replaced.
  const after = valuesFromPdf(result);
  if (after.amount === null || Math.abs(after.amount - newAmount) >= 0.005) {
    return {
      data: null,
      hits,
      rejected,
      grund: `After replacing, the amount reads as ${after.amount} ` + `instead of ${newAmount}`,
    };
  }
  if (after.number !== before.number || after.pin !== before.pin) {
    return { data: null, hits, rejected, grund: 'Number or PIN changed while replacing' };
  }
  return { data: result, hits, rejected, grund: null };
}

/** So an exported PDF explains itself on import, instead of being guessed at. */
const MARK_HEADER = 'BIM-GUTSCHEIN v1';

/** Semicolon as the separator, because notes have commas.
 * NOTE: the field labels (nummer=/pin=/betrag=/waehrung=) are a persisted export
 * format read back by readMark() — they must not change. */
export function markText(w: { nummer: string; pin: string | null; betrag: number; waehrung: string }): string {
  return (
    `${MARK_HEADER} nummer=${w.nummer}; pin=${w.pin ?? ''}; ` + `betrag=${w.betrag.toFixed(2)}; waehrung=${w.waehrung}`
  );
}

export function readMark(line: string): ParsedVoucher | null {
  if (!line.includes(MARK_HEADER)) return null;
  const field = (name: string) => line.match(new RegExp(`${name}=([^;]*)`))?.[1]?.trim() ?? '';
  const number = field('nummer');
  if (!number) return null;
  const amount = parseFloat(field('betrag'));
  return {
    number,
    pin: field('pin') || null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: field('waehrung') || null,
  };
}

export interface ExportVoucher {
  id: number;
  number: string;
  pin: string | null;
  amount: number;
  currency: string;
  /** null for a purely manual entry. */
  pdf: Buffer | null;
}

// Four kinds, so "already matched" shows up as success, not as a warning.
export interface ExportResult {
  id: number;
  number: string;
  /** 'unveraendert': it should have been replaced and was NOT (with a reason);
   * 'stimmte_schon' is neither an intervention nor an error. */
  art: 'ersetzt' | 'stimmte_schon' | 'unveraendert' | 'erzeugt';
  grund: string | null;
}

/** A manually entered voucher has no original in which to replace anything. */
async function buildPage(g: ExportVoucher): Promise<Buffer> {
  const doc = await PdfLibDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gray = rgb(0.45, 0.45, 0.45);

  page.drawText('Geschenkkarte', { x: 60, y: 760, size: 22, font: bold });
  // LITERALLY the original's sentence, so that readPageByPage finds it just as
  // it would on a real card.
  page.drawText(
    `Ihre LEGO-Geschenkkarte im Wert von ` +
      `${g.amount
        .toLocaleString('de-CH', { minimumFractionDigits: Number.isInteger(g.amount) ? 0 : 2 })
        .replace(/’/g, "'")} ${g.currency}:`,
    { x: 60, y: 700, size: 14, font: normal },
  );
  page.drawText(g.number, { x: 60, y: 660, size: 16, font: bold });
  if (g.pin) page.drawText(`PIN: ${g.pin}`, { x: 60, y: 630, size: 14, font: normal });
  page.drawText('Von Hand erfasst — zu diesem Gutschein liegt kein Original-PDF vor.', {
    x: 60,
    y: 590,
    size: 9,
    font: normal,
    color: gray,
  });
  return Buffer.from(await doc.save());
}

/** A voucher that was not replaced is still included, with a reason in the result:
 * an explanation, not an abort. */
export async function combineVouchers(
  vouchers: ExportVoucher[],
): Promise<{ pdf: Buffer; results: ExportResult[] }> {
  const target = await PdfLibDocument.create();
  const mark = await target.embedFont(StandardFonts.Helvetica);
  const befunde: ExportResult[] = [];

  for (const g of vouchers) {
    let source: Buffer;
    if (g.pdf) {
      const r = await replaceAmount(g.pdf, g.amount);
      if (r.data) {
        source = r.data;
        // No hit does NOT mean "failed" here: the amount was already correct.
        befunde.push({ id: g.id, number: g.number, art: r.hits ? 'ersetzt' : 'stimmte_schon', grund: null });
      } else {
        source = g.pdf;
        befunde.push({ id: g.id, number: g.number, art: 'unveraendert', grund: r.grund });
      }
    } else {
      source = await buildPage(g);
      befunde.push({ id: g.id, number: g.number, art: 'erzeugt', grund: null });
    }

    const doc = await PdfLibDocument.load(source);
    const copies = await target.copyPages(doc, doc.getPageIndices());
    copies.forEach((s, i) => {
      target.addPage(s);
      // The mark only on the FIRST page of a voucher.
      if (i === 0) {
        s.drawText(markText({ nummer: g.number, pin: g.pin, betrag: g.amount, waehrung: g.currency }), {
          x: 28,
          y: 18,
          size: 6,
          font: mark,
          color: rgb(0.45, 0.45, 0.45),
        });
      }
    });
  }

  return { pdf: Buffer.from(await target.save()), results: befunde };
}

/** Exception: a PDF that cannot be read page by page is a single voucher — the
 * empty list here means "not splittable", not "nothing found". */
export function pagesOrNone(data: Buffer): Promise<ParsedVoucher[]> {
  return readPageByPage(data).catch(meldeUndLiefere('gutschein:seitenweise', []));
}

/** Marks first, because they are a direct read; guessing only as a fallback. */
export async function readPageByPage(data: Buffer): Promise<ParsedVoucher[]> {
  const found: ParsedVoucher[] = [];
  const seen = new Set<string>();

  for (const line of pdfText(data).split('\n')) {
    const w = readMark(line);
    if (w?.number && !seen.has(w.number)) {
      seen.add(w.number);
      found.push(w);
    }
  }
  if (found.length) return found;

  const doc = await PdfLibDocument.load(data);
  for (const i of doc.getPageIndices()) {
    const single = await PdfLibDocument.create();
    const [page] = await single.copyPages(doc, [i]);
    single.addPage(page);
    const w = valuesFromPdf(Buffer.from(await single.save()));
    if (w.number && !seen.has(w.number)) {
      seen.add(w.number);
      found.push(w);
    }
  }
  return found;
}
