// Our own reader: pdfkit can only write.
import zlib from 'node:zlib';

export interface ParsedVoucher {
  number: string | null;
  pin: string | null;
  amount: number | null;
  currency: string | null;
}

/** Deliberately closed: almost any three-letter word matches "PDF" as well as "CHF". */
const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK'] as const;

/** Without guessing: an ambiguous notation stays null. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[\s'’`]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const sep = Math.max(lastDot, lastComma);

  let whole: string, frac: string;
  if (sep === -1) {
    whole = s;
    frac = '';
  } else {
    const after = s.length - sep - 1;
    // Exactly three digits after the single separator is ambiguous; a voucher
    // over 1,234 CHF does not exist, over 1234 it does — so a thousands separator.
    const onlyOneSep = s.replace(/[.,]/g, '').length === s.length - 1;
    if (after === 3 && onlyOneSep) {
      whole = s.replace(/[.,]/g, '');
      frac = '';
    } else if (after > 0 && after <= 2) {
      whole = s.slice(0, sep).replace(/[.,]/g, '');
      frac = s.slice(sep + 1);
    } else {
      whole = s.replace(/[.,]/g, '');
      frac = '';
    }
  }
  const n = Number(frac ? `${whole}.${frac}` : whole);
  return Number.isFinite(n) ? n : null;
}

function readLiteral(raw: string): string {
  // \ddd (octal), \n \r \t \b \f, \( \) \\ and the line continuation `\<NL>`.
  return raw.replace(/\\(?:(\d{1,3})|(\r\n|\n|\r)|(.))/g, (_m, octal, _nl, char) => {
    if (octal) return String.fromCharCode(parseInt(octal, 8));
    if (_nl) return '';
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      default:
        return char; // \( \) \\ and everything else literally
    }
  });
}

function readHex(raw: string): string {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, '');
  const pairs = hex.length % 2 ? hex + '0' : hex; // odd: pad with 0 (PDF rule)
  let out = '';
  for (let i = 0; i < pairs.length; i += 2) out += String.fromCharCode(parseInt(pairs.slice(i, i + 2), 16));
  return out;
}

export interface TextOperator {
  from: number;
  to: number;
  op: string;
  /** For TJ, the numbers between the strings are spacing, not content. */
  text: string;
}

const isHex = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102) || c === 32 || (c >= 9 && c <= 13);
const isBlank = (c: number) => c === 32 || (c >= 9 && c <= 13) || c === 0;

function literalEnd(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 92)
      j++; // escape
    else if (c === 40)
      depth++; // (
    else if (c === 41 && --depth === 0) return j + 1; // )
  }
  return -1;
}

function hexEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 62) return j + 1;
    if (!isHex(c)) return -1;
  }
  return -1;
}

type Operand = { end: number; text: string };

/** `[…]` of a TJ: literals and hex strings in a row. null: a literal without end stops the lexer. */
function arrayOperand(s: string, i: number): Operand | null {
  let end = -1,
    text = '';
  let j = i + 1;
  while (j < s.length && end < 0) {
    const d = s.charCodeAt(j);
    if (d === 93) end = j + 1;
    else if (d === 91) break;
    else if (d === 40) {
      const e = literalEnd(s, j);
      if (e < 0) return null;
      text += readLiteral(s.slice(j + 1, e - 1));
      j = e;
    } else if (d === 60) {
      const e = hexEnd(s, j);
      if (e < 0) break;
      text += readHex(s.slice(j + 1, e - 1));
      j = e;
    } else j++;
  }
  return { end, text };
}

/** The string operand starting at i (`end` -1: none); null: a literal without end stops the lexer. */
function operand(s: string, i: number): Operand | null {
  const c = s.charCodeAt(i);
  if (c === 40) {
    // (
    const end = literalEnd(s, i);
    return end < 0 ? null : { end, text: readLiteral(s.slice(i + 1, end - 1)) };
  }
  if (c === 60 && s.charCodeAt(i + 1) !== 60) {
    // < but not <<
    const end = hexEnd(s, i);
    return { end, text: end > 0 ? readHex(s.slice(i + 1, end - 1)) : '' };
  }
  if (c === 91) return arrayOperand(s, i); // [
  return { end: -1, text: '' };
}

/** A lexer instead of a pattern: `(\(\(\(…` with no end would cost quadratic
 * time with a pattern. Here every character is looked at at most twice;
 * literal strings may contain balanced parentheses. */
export function textOperators(s: string): TextOperator[] {
  const out: TextOperator[] = [];
  let i = 0;
  while (i < s.length) {
    const o = operand(s, i);
    if (!o) break;
    if (o.end < 0) {
      i++;
      continue;
    }
    let k = o.end;
    while (k < s.length && isBlank(s.charCodeAt(k))) k++;
    const op = ['TJ', 'Tj', "'", '"'].find(x => s.startsWith(x, k));
    if (op) out.push({ from: i, to: k + op.length, op, text: o.text });
    i = op ? k + op.length : o.end;
  }
  return out;
}

/** Without a limit, 299 KB was unpacked into 300 MB. Anything above that is not
 * a voucher, and it does not even reach pdf-lib, which unpacks without a limit. */
export const STREAM_MAX_BYTES = 5 * 1024 * 1024;
export const UNPACKED_MAX_BYTES = 20 * 1024 * 1024;
export const STREAMS_MAX = 2000;

export class PdfTooLarge extends Error {}

/** The next `stream … endstream` from `from`: content bounds and where to search on;
 * `skip`: the word without a line break, not a stream. */
function nextStream(raw: string, from: number): { start: number; end: number; next: number } | 'skip' | null {
  const start0 = raw.indexOf('stream', from);
  if (start0 < 0) return null;
  let start = start0 + 6;
  if (raw[start] === '\r') start++;
  if (raw[start] !== '\n') return 'skip';
  start++;
  const end = raw.indexOf('endstream', start);
  return end < 0 ? null : { start, end, next: end + 9 };
}

/** Deflated or raw; a stream that unpacks too large ends the reading. */
function streamContent(stream: Buffer): { content: string; bytes: number } {
  try {
    const flat = zlib.inflateSync(stream, { maxOutputLength: STREAM_MAX_BYTES });
    return { content: flat.toString('latin1'), bytes: flat.length };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
      throw new PdfTooLarge(`a stream unpacks to more than ${STREAM_MAX_BYTES} bytes`);
    return { content: stream.toString('latin1'), bytes: 0 };
  }
}

// One line per operator: number alone.
export function pdfText(data: Buffer): string {
  const raw = data.toString('latin1');
  const lines: string[] = [];
  let streams = 0,
    unpacked = 0;

  // Via indexOf instead of a lazy pattern: this ran, with many `stream` with no
  // end, from every match to the end of the file.
  for (let from = 0; ; ) {
    const found = nextStream(raw, from);
    if (!found) break;
    if (found === 'skip') {
      from = raw.indexOf('stream', from) + 1;
      continue;
    }
    from = found.next;
    if (++streams > STREAMS_MAX) throw new PdfTooLarge(`more than ${STREAMS_MAX} streams`);
    const { content, bytes } = streamContent(Buffer.from(raw.slice(found.start, found.end), 'latin1'));
    unpacked += bytes;
    if (unpacked > UNPACKED_MAX_BYTES) throw new PdfTooLarge('too much unpacked content');
    for (const t of textOperators(content)) if (t.text.trim()) lines.push(t.text);
  }
  return lines.join('\n');
}

/** Public, so the mapping "which number is what" can be checked without a PDF. */
export function valuesFromText(text: string): ParsedVoucher {
  const w = CURRENCIES.join('|');

  // First the phrasings that NAME the amount, then "any number next to a
  // currency code": the fine print could happen to contain one. All
  // repetitions bounded: the text is foreign, and `\s*` next to `[…\s]+?`
  // costs quadratic time on long runs of whitespace.
  const amountPatterns = [
    new RegExp(`im\\s{1,9}Wert\\s{1,9}von\\s{1,9}([\\d'’.,\\s]{1,30}?)\\s{0,9}(${w})\\b`, 'i'),
    new RegExp(`value\\s{1,9}of\\s{1,9}([\\d'’.,\\s]{1,30}?)\\s{0,9}(${w})\\b`, 'i'),
    new RegExp(`\\b([\\d'’.,]{1,30})\\s{0,9}(${w})\\b`),
  ];
  let amount: number | null = null,
    currency: string | null = null;
  for (const pattern of amountPatterns) {
    const m = text.match(pattern);
    if (m) {
      amount = parseNumber(m[1] ?? '');
      currency = (m[2] ?? '').toUpperCase();
      if (amount !== null) break;
    }
  }
  if (amount === null) {
    const m = text.match(new RegExp(`\\b(${w})\\s{0,9}([\\d'’.,]{1,30})`, 'i'));
    if (m) {
      currency = (m[1] ?? '').toUpperCase();
      amount = parseNumber(m[2] ?? '');
    }
  }

  // Anchored on the word, not on position.
  const pinMatch = text.match(/\bPIN\b\s{0,9}[:.-]?\s{0,9}(\d{3,8})\b/i);
  const pin = pinMatch ? (pinMatch[1] ?? null) : null;

  // The longest digit run of at least 13 digits: the floor keeps years and PIN
  // out, "longest" keeps a phone number in the fine print out.
  const candidates: string[] = text.match(/\d{13,22}/g) ?? [];
  const number = candidates.length ? candidates.reduce((a, b) => (b.length > a.length ? b : a)) : null;

  return { number, pin, amount, currency };
}

export function valuesFromPdf(data: Buffer): ParsedVoucher {
  return valuesFromText(pdfText(data));
}
