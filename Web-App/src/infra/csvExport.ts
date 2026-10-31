
// Small helper to build CSV text from rows of plain values, with correct
// quoting/escaping for fields containing commas, quotes or newlines.
// Used by the various "Export als CSV" endpoints so the exported files can
// be re-imported with the matching CSV importer (Sets / Teile / Minifiguren).

/**
 * Zeichen, mit denen Tabellenprogramme eine Formel beginnen lassen.
 * Tabulator und Wagenrücklauf gehören dazu, weil Excel sie als Trennzeichen
 * liest und das folgende Feld dann wieder als Formel behandeln kann.
 */
const FORMEL_START = /^[=+\-@\t\r]/;

/**
 * Nur der Ausschnitt von Express' Response, den diese Datei braucht.
 *
 * Statt @types/express hereinzuziehen: Diese Datei kennt Express sonst nicht,
 * und ein Ausschnitt sagt genauer, was sie tut — Kopfzeilen setzen und senden.
 */
type ExpressAntwort = {
  setHeader(name: string, value: string): void;
  send(body: string | Buffer): unknown;
};

/**
 * Derselbe Gedanke fuer die JSON-Antwort des Imports: nur `json`, weil nur das
 * gebraucht wird. Ein gemeinsamer Typ mit ExpressAntwort haette jeder der
 * beiden Funktionen Faehigkeiten angedichtet, die sie nicht benutzen.
 */
type ExpressJsonAntwort = {
  json(body: unknown): unknown;
};

/**
 * Ein Feld gegen Formelausführung entschärfen.
 * Ausführlich: docs/begruendungen/src/infra/csvExport.ts.md#entschaerfe
 */
function entschaerfe(s: string): string {
  if (!FORMEL_START.test(s)) return s;
  if (/^-?\d+([.,]\d+)?$/.test(s)) return s;   // reine Zahl, auch negativ
  return "'" + s;
}

/** Gegenstück zu entschaerfe() für den Import. */
// `unknown`: Die Werte kommen aus geparsten CSV-Zeilen, sind also nicht
// zwingend Zeichenketten — der Rumpf prueft das als Erstes selbst.
function entschaerfungRueckgaengig(v: unknown) {
  if (typeof v !== 'string') return v;
  if (v.length > 1 && v[0] === "'" && FORMEL_START.test(v.slice(1))) return v.slice(1);
  return v;
}

/**
 * Alle Werte eingelesener CSV-Zeilen entschärfen-rückgängig machen.
 *
 * Gehört direkt hinter jedes parse() der drei Importwege (Sets, Teile,
 * Minifiguren), damit ein hier erzeugter Export unverändert wieder eingelesen
 * werden kann.
 */
function csvZeilenBereinigen(records: any[]): any[] {
  return records.map(row => {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) out[k] = entschaerfungRueckgaengig(v);
    return out;
  });
}

function csvField(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = entschaerfe(String(v));
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h: string) => csvField(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function sendCsv(res: ExpressAntwort, filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM so Excel opens UTF-8 correctly
}

// sendCsvText() ist mit seinen drei Aufrufern ENTFERNT.
// Ausführlich: docs/begruendungen/src/infra/csvExport.ts.md#abschnitt

export { csvField, toCsv, sendCsv, parseCsvDate, entschaerfe, entschaerfungRueckgaengig, csvZeilenBereinigen };

/**
 * Datumsangabe aus einer CSV-Datei in ISO-Form (YYYY-MM-DD) bringen.
 * Ausführlich: docs/begruendungen/src/infra/csvExport.ts.md#parsecsvdate
 * @param {string|null|undefined} raw
 * @returns {string|null} ISO-Datum oder null, wenn nichts Brauchbares drinsteht
 */
function parseCsvDate(raw: unknown) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Bereits ISO — unverändert übernehmen
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Tag zuerst, mit Punkt oder Schrägstrich
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const day = parseInt((m[1] ?? '')), mon = parseInt((m[2] ?? ''));
    let year = parseInt((m[3] ?? ''));
    if ((m[3] ?? '').length === 2) year += year < 70 ? 2000 : 1900;
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
    // Gegenprobe über ein echtes Datum: 31.02. gibt es nicht, die Prüfung auf
    // 1–31 allein liesse es durch. Date rollt einen ungültigen Tag in den
    // Folgemonat — kommt etwas anderes heraus als hineingegeben, war es falsch.
    const probe = new Date(Date.UTC(year, mon - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== mon - 1 ||
        probe.getUTCDate() !== day) return null;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}


/**
 * CSV-Datei einlesen — fehlerhafte Zeilen überspringen statt alles abzubrechen.
 * Ausführlich: docs/begruendungen/src/infra/csvExport.ts.md#gefaehrliche-spalten
 * @param csvText Dateiinhalt (BOM darf drin sein)
 * @returns { records, delimiter, uebersprungen } — uebersprungen sind
 */
/**
 * Spaltennamen, die kein Datenfeld sein koennen, sondern die Prototypenkette
 * treffen. Siehe die Begruendung an `columns:` unten.
 */
const GEFAEHRLICHE_SPALTEN = new Set(['__proto__', 'constructor', 'prototype']);

function csvEinlesen(csvText: string): { records: any[]; delimiter: string; uebersprungen: number[] } {
  const { parse } = require('csv-parse/sync');
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const firstLine = text.split('\n')[0] || '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const uebersprungen: number[] = [];
  const records = parse(text, {
    // Warum die Kopfzeile gefiltert wird
    // `columns: true` macht aus jeder Kopfspalte einen Objektschluessel. Heisst
    // eine Spalte `__proto__`, `constructor` oder `prototype`, schreibt das
    // Ergebnis in die Prototypenkette statt in den Datensatz — genau der Pfad, …
    // Ausführlich: docs/begruendungen/src/infra/csvExport.ts.md#csveinlesen
    columns: (kopf: string[]) => kopf.map(name => {
      const rein = String(name || '').trim();
      return GEFAEHRLICHE_SPALTEN.has(rein) ? false : rein;
    }),
    skip_empty_lines: true,
    trim: true,
    delimiter,
    // Zeilen mit falscher Spaltenzahl nicht als Fehler behandeln …
    relax_column_count: true,
    // … und ein verirrtes Anführungszeichen mitten im Feld ebenfalls nicht.
    relax_quotes: true,
  });

  // Zeilen ohne jeden Inhalt (alle Felder leer) gelten als übersprungen — das
  // ist der Fall, den `relax_column_count` aus einer krummen Zeile macht.
  const brauchbar: any[] = [];
  records.forEach((r: any, i: number) => {
    const werte = Object.values(r).map(v => String(v ?? '').trim());
    if (werte.some(v => v !== '')) brauchbar.push(r);
    else uebersprungen.push(i + 2);   // +2: Kopfzeile plus 1-basiert
  });

  return { records: brauchbar, delimiter, uebersprungen };
}

/**
 * Hinweistext zu übersprungenen Zeilen — oder null, wenn alles sauber war.
 * Höchstens zehn Zeilennummern, sonst wird die Meldung länger als hilfreich.
 */
function uebersprungenHinweis(zeilen: number[]): string | null {
  if (!zeilen.length) return null;
  const liste = zeilen.slice(0, 10).join(', ');
  const rest  = zeilen.length > 10 ? ` und ${zeilen.length - 10} weitere` : '';
  return `${zeilen.length} Zeile(n) übersprungen (Zeile ${liste}${rest})`;
}

export { csvEinlesen, uebersprungenHinweis };

/**
 * Die Felder, die JEDE Import-Zeile hat — mit allen Spaltennamen, die gelten.
 * Ausführlich: docs/begruendungen/src/infra/csvExport.ts.md#csvgemeinsamefelder
 */
function csvGemeinsameFelder(row: any): {
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

/**
 * Datei einlesen, entschaerfen, zaehlen — der gleiche Anfang beider Importe.
 *
 * `records` bleibt getrennt von `bereinigt`, weil die Antwort `total` aus der
 * UNGEFILTERTEN Zahl bildet: Wie viele Zeilen standen in der Datei.
 */
function csvZeilenAusAnfrage(text: string): {
  records: any[]; bereinigt: any[]; uebersprungen: number[];
} {
  // Krumme Zeilen ueberspringen statt abbrechen (csvEinlesen).
  const gelesen = csvEinlesen(text);
  return {
    records: gelesen.records,
    // Hochkomma vor Formelzeichen wieder entfernen — der eigene Export setzt es
    // gegen Formelausfuehrung in Tabellenprogrammen.
    bereinigt: csvZeilenBereinigen(gelesen.records),
    uebersprungen: gelesen.uebersprungen,
  };
}

/**
 * Die Antwort beider Importe — an einer Stelle, damit beide Oberflaechen
 * dieselben Felder bekommen.
 */
function csvImportAntwort(res: ExpressJsonAntwort, d: {
  added: number; updated: number; errors: number;
  records: any[]; results: any[]; uebersprungen: number[];
}) {
  res.json({
    success: true, added: d.added, updated: d.updated, errors: d.errors,
    total: d.records.length, results: d.results,
    skipped: d.uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(d.uebersprungen) || undefined,
  });
}

export { csvGemeinsameFelder, csvZeilenAusAnfrage, csvImportAntwort };
