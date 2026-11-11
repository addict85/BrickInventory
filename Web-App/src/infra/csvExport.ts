
// CSV mit richtigem Quoting, damit ein Export mit dem passenden Import unverändert wieder eingelesen werden kann.
import { parse } from 'csv-parse/sync';
import { fehlerText, type Sprache } from './fehlerTexte';

/** Tabulator und Wagenrücklauf gehören dazu: Excel liest sie als Trennzeichen
 * und behandelt das folgende Feld wieder als Formel. Auch nach Leerraum und in
 * voller Breite (＝＋－＠): Manche Programme trimmen oder falten sie. */
const FORMEL_START = /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;
/** Komma, Semikolon (deutsches Excel) und Tabulator trennen Felder, CR und LF Zeilen. */
const MUSS_IN_ANFUEHRUNG = /[",;\t\r\n]/;

/** Ein Ausschnitt statt @types/express: Er sagt genauer, was diese Datei tut. */
type ExpressAntwort = {
  setHeader(name: string, value: string): void;
  send(body: string | Buffer): unknown;
};

// Ein Feld mit = führte Excel beim Öffnen aus.
export function entschaerfe(s: string): string {
  if (!FORMEL_START.test(s)) return s;
  if (/^\s*-?\d+([.,]\d+)?\s*$/.test(s)) return s;   // reine Zahl, auch negativ
  return "'" + s;
}

// `unknown`: Werte aus geparsten CSV-Zeilen sind nicht zwingend Zeichenketten.
export function entschaerfungRueckgaengig(v: unknown) {
  if (typeof v !== 'string') return v;
  if (v.length > 1 && v[0] === "'" && FORMEL_START.test(v.slice(1))) return v.slice(1);
  return v;
}

/** Hinter jedes parse() der Importwege, damit ein eigener Export unverändert
 * wieder eingelesen wird. */
export function csvZeilenBereinigen(records: any[]): any[] {
  return records.map(row => {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) out[k] = entschaerfungRueckgaengig(v);
    return out;
  });
}

export function csvField(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = entschaerfe(String(v));
  if (MUSS_IN_ANFUEHRUNG.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h: string) => csvField(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function sendCsv(res: ExpressAntwort, filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM so Excel opens UTF-8 correctly
}

/** @returns ISO-Datum oder null, wenn nichts Brauchbares drinsteht */
export function parseCsvDate(raw: unknown) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const day = parseInt((m[1] ?? '')), mon = parseInt((m[2] ?? ''));
    let year = parseInt((m[3] ?? ''));
    if ((m[3] ?? '').length === 2) year += year < 70 ? 2000 : 1900;
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
    // Über ein echtes Datum prüfen: 31.02. gibt es nicht; Date rollt ihn in den Folgemonat, und das fällt hier auf.
    const probe = new Date(Date.UTC(year, mon - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== mon - 1 ||
        probe.getUTCDate() !== day) return null;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/** Treffen die Prototypenkette statt eines Datenfelds. */
const GEFAEHRLICHE_SPALTEN = new Set(['__proto__', 'constructor', 'prototype']);

/** `zeilen[i]` ist die Zeile der Datei, in der `records[i]` steht: Leerzeilen verschieben sonst die Zählung. */
export function csvEinlesen(csvText: string): { records: any[]; delimiter: string; uebersprungen: number[]; zeilen: number[] } {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const firstLine = text.split('\n')[0] || '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const uebersprungen: number[] = [];
  const records = parse(text, {
    // Die Kopfzeile filtern: `columns: true` macht aus `__proto__` einen
    // Schlüssel, der in die Prototypenkette schreibt.
    columns: (kopf: string[]) => kopf.map(name => {
      const rein = String(name || '').trim();
      return GEFAEHRLICHE_SPALTEN.has(rein) ? false : rein;
    }),
    skip_empty_lines: true,
    trim: true,
    delimiter,
    // Krumme Zeilen und verirrte Anführungszeichen überspringen statt alles abzubrechen.
    relax_column_count: true,
    relax_quotes: true,
    info: true,
  }) as { record: any; info: { lines: number } }[];

  // Zeilen ohne Inhalt gelten als übersprungen — das macht `relax_column_count` aus einer krummen Zeile.
  const brauchbar: any[] = [];
  const zeilen: number[] = [];
  records.forEach(({ record: r, info }) => {
    const werte = Object.values(r).map(v => String(v ?? '').trim());
    if (werte.some(v => v !== '')) { brauchbar.push(r); zeilen.push(info.lines); }
    else uebersprungen.push(info.lines);
  });

  return { records: brauchbar, delimiter, uebersprungen, zeilen };
}

/** Höchstens zehn Zeilennummern, sonst wird die Meldung länger als hilfreich. */
export function zeilenListe(zeilen: number[]): string {
  return zeilen.slice(0, 10).join(', ') + (zeilen.length > 10 ? ', …' : '');
}

export function uebersprungenHinweis(zeilen: number[], sprache: Sprache = 'de'): string | null {
  if (!zeilen.length) return null;
  return fehlerText('csv_uebersprungen', sprache, { anzahl: zeilen.length, zeilen: zeilenListe(zeilen) });
}

// Die gemeinsamen Spalten einmal gelesen, damit jede Behebung alle Importe trifft.
export function csvGemeinsameFelder(row: any): {
  menge: number;
  preis: number | null;
  erfasstAm: string | null;
  zustand: string;
} {
  const rohPreis = row.unit_price ?? row['Preis'] ?? '';
  let preis: number | null = String(rohPreis).trim() !== ''
    ? parseFloat(String(rohPreis).replace(',', '.')) : null;
  if (preis !== null && isNaN(preis)) preis = null;
  return {
    menge: parseInt(String(row.quantity || row['Anzahl'] || '1').replace(/[^0-9]/g, '')) || 1,
    preis,
    erfasstAm: parseCsvDate(row.acquired_at || row['erfassungsdatum']),
    zustand: (row.condition || row['zustand'] || '').trim().toUpperCase(),
  };
}

/** `records` bleibt getrennt von `bereinigt`: `total` nennt die Zeilen der Datei. */
export function csvZeilenAusAnfrage(text: string): {
  records: any[]; bereinigt: any[]; uebersprungen: number[];
} {
  const gelesen = csvEinlesen(text);
  return {
    records: gelesen.records,
    // Das Hochkomma vor Formelzeichen setzt der eigene Export; hier kommt es weg.
    bereinigt: csvZeilenBereinigen(gelesen.records),
    uebersprungen: gelesen.uebersprungen,
  };
}

/** An einer Stelle, damit beide Oberflächen dieselben Felder bekommen. */
/** Was jeder CSV-Import antwortet; `records` zählt nur. */
export interface ImportZeilenErgebnis {
  set_number?: string; action?: string; error?: string | null; isWarning?: boolean; success?: boolean;
  [feld: string]: unknown;
}
export function csvImportBericht(d: {
  added: number; updated: number; errors: number;
  records: unknown[]; results: ImportZeilenErgebnis[]; uebersprungen: number[];
}) {
  return {
    added: d.added, updated: d.updated, errors: d.errors,
    total: d.records.length, results: d.results,
    skipped: d.uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(d.uebersprungen) || undefined,
  };
}
export type CsvImportBericht = ReturnType<typeof csvImportBericht>;

