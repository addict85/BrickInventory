// CSV with correct quoting, so that an export can be read back unchanged with the matching import.
import { parse } from 'csv-parse/sync';
import { errorText, type Language } from './errorTexts';

/** Tab and carriage return belong to it: Excel reads them as separators
 * and treats the following field as a formula again. Also after whitespace and in
 * full width (＝＋－＠): some programs trim or fold them. */
const FORMULA_START = /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;
/** Comma, semicolon (German Excel) and tab separate fields, CR and LF rows. */
const MUST_IN_QUOTE = /[",;\t\r\n]/;

// Excel executed a field with = when opening.
export function defuse(s: string): string {
  if (!FORMULA_START.test(s)) return s;
  if (/^\s*-?\d+([.,]\d+)?\s*$/.test(s)) return s; // plain number, negative too
  return "'" + s;
}

// `unknown`: values from parsed CSV rows are not necessarily strings.
export function defusingUndo(v: unknown) {
  if (typeof v !== 'string') return v;
  if (v.length > 1 && v[0] === "'" && FORMULA_START.test(v.slice(1))) return v.slice(1);
  return v;
}

/** A row read in; with `columns` csv-parse delivers every value as text. */
export type CsvRow = Record<string, string>;

/** Behind every parse() of the import paths, so that an own export is read back
 * unchanged. */
export function csvRowsClean(records: CsvRow[]): CsvRow[] {
  return records.map(row => {
    const out: CsvRow = {};
    for (const [k, v] of Object.entries(row)) out[k] = defusingUndo(v) as string;
    return out;
  });
}

export function csvField(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = defuse(String(v));
  if (MUST_IN_QUOTE.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h: string) => csvField(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** @returns ISO date or null if nothing usable is in it */
export function csvDatum(raw: unknown) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const day = parseInt(m[1] ?? '', 10),
      mon = parseInt(m[2] ?? '', 10);
    let year = parseInt(m[3] ?? '', 10);
    if ((m[3] ?? '').length === 2) year += year < 70 ? 2000 : 1900;
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
    // Check via a real date: 31.02. does not exist; Date rolls it into the next month, and that is noticed here.
    const probe = new Date(Date.UTC(year, mon - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== mon - 1 || probe.getUTCDate() !== day) return null;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/** Hit the prototype chain instead of a data field. */
const DANGEROUS_COLUMNS = new Set(['__proto__', 'constructor', 'prototype']);

/** `zeilen[i]` is the line of the file in which `records[i]` stands: blank lines would otherwise shift the count. */
export function csvReadIn(csvText: string): {
  records: CsvRow[];
  delimiter: string;
  uebersprungen: number[];
  zeilen: number[];
} {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const firstLine = text.split('\n')[0] || '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const uebersprungen: number[] = [];
  const records = parse(text, {
    // Filter the header row: `columns: true` turns `__proto__` into a
    // key that writes into the prototype chain.
    columns: (header: string[]) =>
      header.map(name => {
        const rein = String(name || '').trim();
        return DANGEROUS_COLUMNS.has(rein) ? false : rein;
      }),
    skip_empty_lines: true,
    trim: true,
    delimiter,
    // Skip crooked rows and stray quotes instead of aborting everything.
    relax_column_count: true,
    relax_quotes: true,
    info: true,
  }) as { record: CsvRow; info: { lines: number } }[];

  // Rows without content count as skipped — that is what `relax_column_count` makes of a crooked row.
  const usable: CsvRow[] = [];
  const zeilen: number[] = [];
  records.forEach(({ record: r, info }) => {
    const werte = Object.values(r).map(v => String(v ?? '').trim());
    if (werte.some(v => v !== '')) {
      usable.push(r);
      zeilen.push(info.lines);
    } else uebersprungen.push(info.lines);
  });

  return { records: usable, delimiter, uebersprungen, zeilen };
}

/** At most ten line numbers, otherwise the message gets longer than helpful. */
export function rowsList(zeilen: number[]): string {
  return zeilen.slice(0, 10).join(', ') + (zeilen.length > 10 ? ', …' : '');
}

export function skippedHint(zeilen: number[], language: Language = 'de'): string | null {
  if (!zeilen.length) return null;
  return errorText('csv_uebersprungen', language, { anzahl: zeilen.length, zeilen: rowsList(zeilen) });
}

// The shared columns read once, so that every fix hits all imports.
export function csvSharedFields(row: CsvRow): {
  menge: number;
  preis: number | null;
  recordedAt: string | null;
  zustand: string;
} {
  const rawPrice = row.unit_price ?? row.Preis ?? '';
  let preis: number | null = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
  if (preis !== null && Number.isNaN(preis)) preis = null;
  return {
    menge: parseInt(String(row.quantity || row.Anzahl || '1').replace(/[^0-9]/g, ''), 10) || 1,
    preis,
    recordedAt: csvDatum(row.acquired_at || row.erfassungsdatum),
    zustand: (row.condition || row.zustand || '').trim().toUpperCase(),
  };
}

/** `records` stays separate from `cleaned`: `total` names the rows of the file. */
export function csvRowsFromRequest(text: string): {
  records: CsvRow[];
  cleaned: CsvRow[];
  uebersprungen: number[];
} {
  const gelesen = csvReadIn(text);
  return {
    records: gelesen.records,
    // The apostrophe before formula characters is set by the own export; it is removed here.
    cleaned: csvRowsClean(gelesen.records),
    uebersprungen: gelesen.uebersprungen,
  };
}

/** In one place, so that both UIs get the same fields. */
/** What every CSV import answers; `records` only counts. */
export interface ImportRowsResult {
  set_number?: string;
  action?: string;
  error?: string | null;
  isWarning?: boolean;
  success?: boolean;
  [field: string]: unknown;
}
export function csvImportReport(d: {
  added: number;
  updated: number;
  errors: number;
  records: unknown[];
  results: ImportRowsResult[];
  uebersprungen: number[];
}) {
  return {
    added: d.added,
    updated: d.updated,
    errors: d.errors,
    total: d.records.length,
    results: d.results,
    skipped: d.uebersprungen.length || undefined,
    skipped_hint: skippedHint(d.uebersprungen) || undefined,
  };
}
export type CsvImportReport = ReturnType<typeof csvImportReport>;
