/** Der Betrag wird IM Original ersetzt, damit der Export aussieht wie die
 * Karte von LEGO; geht das nicht sicher, bleibt das Original unverändert.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#abschnitt */
import {
  PDFDocument as PdfLibDocument, PDFArray, PDFDict, PDFName, PDFRawStream,
  decodePDFRawStream, PDFPage, PDFObject, StandardFonts, rgb,
} from '@cantoo/pdf-lib';
import { werteAusPdf, pdfText, textOperatoren } from './gutscheinPdf';
import type { GutscheinWerte } from './gutscheinPdf';
import { meldeUndLiefere } from '../infra/fehler';

/** Nur hier druckt eine literale ASCII-Kette, was sie sagt. Ohne /Encoding ist
 * es eine Standardschrift mit StandardEncoding — dort gilt dasselbe. */
const SICHERE_KODIERUNGEN = new Set([
  'WinAnsiEncoding', 'MacRomanEncoding', 'StandardEncoding', 'PDFDocEncoding',
]);

function alsLiteral(text: string): string {
  return '(' + text.replace(/([()\\])/g, '\\$1') + ')';
}

/** Unbekannt heisst NEIN: Eine Schrift, die sich nicht nachsehen lässt, wird
 * nicht angefasst. */
function schriftIstSicher(doc: PdfLibDocument, resources: PDFDict | undefined,
                          name: string): boolean {
  if (!resources) return false;
  const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) return false;
  const eintrag = fonts.get(PDFName.of(name));
  if (eintrag === undefined) return false;
  const font = doc.context.lookupMaybe(eintrag, PDFDict);
  if (!font) return false;

  const subtype = font.get(PDFName.of('Subtype'));
  // Type0 (CID) trägt Glyphennummern; eine literale ASCII-Kette hat damit nichts zu tun.
  if (subtype !== undefined && String(subtype) === '/Type0') return false;

  const enc = font.get(PDFName.of('Encoding'));
  if (enc === undefined) return true;                        // Standardschrift
  const roh = String(enc);
  if (!roh.startsWith('/')) return false;                    // Wörterbuch mit /Differences
  return SICHERE_KODIERUNGEN.has(roh.slice(1));
}

/** Das Kerning eines TJ-Feldes geht verloren; der Betrag steht aber vollständig da.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#ersetzeimstrom */
function ersetzeImStrom(inhalt: string, suchen: string, ersetzen: string,
                        sicher: (schrift: string) => boolean):
                        { aus: string; treffer: number; abgelehnt: number } {
  let treffer = 0, abgelehnt = 0;
  // Die AKTIVE Schrift ist das letzte `/Name <grösse> Tf` vor dem Operator;
  // unbekannt heisst: nicht anfassen.
  const tfs = [...inhalt.matchAll(/\bTf\b/g)].map(m => m.index ?? 0);
  const namen = new Map<number, string>();
  for (const m of inhalt.matchAll(/\/([^\s/<>\][(){}]+)\s+[\d.+-]+\s+Tf/g))
    namen.set((m.index ?? 0) + m[0].length - 2, m[1] ?? '');
  let aus = '', bisher = 0, n = 0;
  for (const t of textOperatoren(inhalt)) {
    if (!t.text.includes(suchen)) continue;
    while (n < tfs.length && (tfs[n] ?? 0) < t.von) n++;
    const schrift = n > 0 ? namen.get(tfs[n - 1] ?? -1) : undefined;
    if (schrift === undefined || !sicher(schrift)) { abgelehnt++; continue; }

    treffer++;
    // TJ wird zu Tj: Ein einzelnes Argument ist kein Feld mehr.
    aus += inhalt.slice(bisher, t.von)
      + alsLiteral(t.text.split(suchen).join(ersetzen)) + ' ' + (t.op === 'TJ' ? 'Tj' : t.op);
    bisher = t.bis;
  }
  aus += inhalt.slice(bisher);
  return { aus, treffer, abgelehnt };
}

function stroemeVon(doc: PdfLibDocument, seite: PDFPage): PDFRawStream[] {
  const c = seite.node.Contents();
  if (c === undefined) return [];
  const liste: unknown[] = c instanceof PDFArray
    ? c.asArray().map((r: PDFObject) => doc.context.lookup(r))
    : [c];
  return liste.filter((s): s is PDFRawStream => s instanceof PDFRawStream);
}

export interface ErsetzBefund {
  /** null, wenn nicht sicher ersetzt werden konnte. */
  daten: Buffer | null;
  treffer: number;
  /** Trugen den Betrag, aber mit unsicherer Schrift. */
  abgelehnt: number;
  grund: string | null;
}

export async function ersetzeBetrag(daten: Buffer, neuerBetrag: number): Promise<ErsetzBefund> {
  const vorher = werteAusPdf(daten);
  if (vorher.betrag === null) {
    return { daten: null, treffer: 0, abgelehnt: 0,
             grund: 'Im PDF ist kein Betrag zu finden' };
  }
  // Nichts zu tun ist Erfolg: Das Original stimmt schon.
  if (Math.abs(vorher.betrag - neuerBetrag) < 0.005) {
    return { daten, treffer: 0, abgelehnt: 0, grund: null };
  }

  // Gesucht wird, wie der Betrag GESCHRIEBEN steht („1'234.50", „1.234,50"),
  // denn das steht im Strom.
  const text = pdfText(daten);
  const geschrieben = text.match(/[\d'’.,]{1,30}(?=\s{0,9}(?:CHF|EUR|USD|GBP|SEK|NOK|AUD|CAD|DKK)\b)/i)?.[0]
    ?? String(vorher.betrag);
  const neuGeschrieben = neuerBetrag.toLocaleString('de-CH', {
    minimumFractionDigits: Number.isInteger(neuerBetrag) ? 0 : 2,
    maximumFractionDigits: 2,
  }).replace(/’/g, "'");

  const doc = await PdfLibDocument.load(daten);
  let treffer = 0, abgelehnt = 0;
  for (const seite of doc.getPages()) {
    const resources = seite.node.Resources();
    const sicher = (name: string) => schriftIstSicher(doc, resources, name);
    for (const strom of stroemeVon(doc, seite)) {
      let roh: Uint8Array;
      try { roh = decodePDFRawStream(strom).decode(); } catch { continue; }
      const inhalt = Buffer.from(roh).toString('latin1');
      const r = ersetzeImStrom(inhalt, geschrieben, neuGeschrieben, sicher);
      treffer += r.treffer; abgelehnt += r.abgelehnt;
      if (!r.treffer) continue;
      strom.contents = Buffer.from(r.aus, 'latin1');
      strom.dict.set(PDFName.of('Length'), doc.context.obj(strom.contents.length));
      // Der Strom liegt jetzt UNKOMPRIMIERT da; mit /Filter versuchte jeder Leser,
      // Klartext zu entpacken.
      strom.dict.delete(PDFName.of('Filter'));
      strom.dict.delete(PDFName.of('DecodeParms'));
    }
  }

  if (!treffer) {
    return { daten: null, treffer: 0, abgelehnt,
             grund: abgelehnt
               ? `Der Betrag steht in einer Schrift mit eigener Kodierung (${abgelehnt}×) — `
                 + 'eine ersetzte Zeichenkette würde dort als Zeichensalat gedruckt'
               : `Die Schreibweise „${geschrieben}" ist im Inhaltsstrom nicht zu finden` };
  }

  const ergebnis = Buffer.from(await doc.save());

  // Nachprüfen: Erst was der Leser findet, zählt als ersetzt.
  const nachher = werteAusPdf(ergebnis);
  if (nachher.betrag === null || Math.abs(nachher.betrag - neuerBetrag) >= 0.005) {
    return { daten: null, treffer, abgelehnt,
             grund: `Nach dem Ersetzen liest sich der Betrag als ${nachher.betrag} `
                  + `statt ${neuerBetrag}` };
  }
  if (nachher.nummer !== vorher.nummer || nachher.pin !== vorher.pin) {
    return { daten: null, treffer, abgelehnt,
             grund: 'Nummer oder PIN haben sich beim Ersetzen verändert' };
  }
  return { daten: ergebnis, treffer, abgelehnt, grund: null };
}

/** Damit ein exportiertes PDF beim Import sich selbst erklärt, statt geraten zu werden.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#marke-kopf */
const MARKE_KOPF = 'BIM-GUTSCHEIN v1';

/** Semikolon als Trennzeichen, weil Notizen Kommas haben. */
export function markeText(w: { nummer: string; pin: string | null; betrag: number;
                               waehrung: string }): string {
  return `${MARKE_KOPF} nummer=${w.nummer}; pin=${w.pin ?? ''}; `
       + `betrag=${w.betrag.toFixed(2)}; waehrung=${w.waehrung}`;
}

export function markeLesen(zeile: string): GutscheinWerte | null {
  if (!zeile.includes(MARKE_KOPF)) return null;
  const feld = (name: string) =>
    zeile.match(new RegExp(`${name}=([^;]*)`))?.[1]?.trim() ?? '';
  const nummer = feld('nummer');
  if (!nummer) return null;
  const betrag = parseFloat(feld('betrag'));
  return {
    nummer,
    pin: feld('pin') || null,
    betrag: Number.isFinite(betrag) ? betrag : null,
    waehrung: feld('waehrung') || null,
  };
}

export interface ExportGutschein {
  id: number;
  number: string;
  pin: string | null;
  amount: number;
  currency: string;
  /** null bei rein manueller Erfassung. */
  pdf: Buffer | null;
}

// Vier Arten, damit „stimmte schon“ als Erfolg erscheint und nicht als Warnung.
// Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#exportbefund
export interface ExportBefund {
  id: number;
  number: string;
  /** 'unveraendert': Es hätte ersetzt werden müssen und ging NICHT (mit Grund);
   * 'stimmte_schon' ist kein Eingriff und kein Fehler. */
  art: 'ersetzt' | 'stimmte_schon' | 'unveraendert' | 'erzeugt';
  grund: string | null;
}

/** Ein von Hand erfasster Gutschein hat kein Original, in dem etwas zu ersetzen wäre.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#erzeugeseite */
async function erzeugeSeite(g: ExportGutschein): Promise<Buffer> {
  const doc = await PdfLibDocument.create();
  const seite = doc.addPage([595, 842]);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const grau = rgb(0.45, 0.45, 0.45);

  seite.drawText('Geschenkkarte', { x: 60, y: 760, size: 22, font: fett });
  // WÖRTLICH der Satz des Originals, damit seitenweiseLesen ihn genauso findet
  // wie auf einer echten Karte.
  seite.drawText(`Ihre LEGO-Geschenkkarte im Wert von `
    + `${g.amount.toLocaleString('de-CH', { minimumFractionDigits: Number.isInteger(g.amount) ? 0 : 2 })
         .replace(/’/g, "'")} ${g.currency}:`,
    { x: 60, y: 700, size: 14, font: normal });
  seite.drawText(g.number, { x: 60, y: 660, size: 16, font: fett });
  if (g.pin) seite.drawText(`PIN: ${g.pin}`, { x: 60, y: 630, size: 14, font: normal });
  seite.drawText('Von Hand erfasst — zu diesem Gutschein liegt kein Original-PDF vor.',
    { x: 60, y: 590, size: 9, font: normal, color: grau });
  return Buffer.from(await doc.save());
}

/** Ein nicht ersetzter Gutschein kommt unverändert hinein, mit Grund im Befund:
 * eine Auskunft, kein Abbruch.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#verbindegutscheine */
export async function verbindeGutscheine(gutscheine: ExportGutschein[]):
    Promise<{ daten: Buffer; befunde: ExportBefund[] }> {
  const ziel = await PdfLibDocument.create();
  const marke = await ziel.embedFont(StandardFonts.Helvetica);
  const befunde: ExportBefund[] = [];

  for (const g of gutscheine) {
    let quelle: Buffer;
    if (g.pdf) {
      const r = await ersetzeBetrag(g.pdf, g.amount);
      if (r.daten) {
        quelle = r.daten;
        // Kein Treffer heisst hier NICHT „gescheitert": Der Betrag stand schon drin.
        befunde.push({ id: g.id, number: g.number,
                       art: r.treffer ? 'ersetzt' : 'stimmte_schon', grund: null });
      } else {
        quelle = g.pdf;
        befunde.push({ id: g.id, number: g.number, art: 'unveraendert', grund: r.grund });
      }
    } else {
      quelle = await erzeugeSeite(g);
      befunde.push({ id: g.id, number: g.number, art: 'erzeugt', grund: null });
    }

    const doc = await PdfLibDocument.load(quelle);
    const kopien = await ziel.copyPages(doc, doc.getPageIndices());
    kopien.forEach((s, i) => {
      ziel.addPage(s);
      // Die Marke nur auf die ERSTE Seite eines Gutscheins.
      if (i === 0) {
        s.drawText(markeText({ nummer: g.number, pin: g.pin, betrag: g.amount,
                               waehrung: g.currency }),
          { x: 28, y: 18, size: 6, font: marke, color: rgb(0.45, 0.45, 0.45) });
      }
    });
  }

  return { daten: Buffer.from(await ziel.save()), befunde };
}

/** Ein PDF, das sich nicht seitenweise lesen lässt, ist ein einzelner Gutschein. */
export function seitenOderKeine(daten: Buffer): Promise<GutscheinWerte[]> {
  return seitenweiseLesen(daten).catch(meldeUndLiefere('gutschein:seitenweise', []));
}

/** Marken zuerst, weil sie eine Ablesung sind; Raten nur als Rückfall.
 * Ausführlich: docs/begruendungen/src/gutscheine/gutscheinPdfSchreiben.ts.md#seitenweiselesen */
export async function seitenweiseLesen(daten: Buffer): Promise<GutscheinWerte[]> {
  const gefunden: GutscheinWerte[] = [];
  const gesehen = new Set<string>();

  for (const zeile of pdfText(daten).split('\n')) {
    const w = markeLesen(zeile);
    if (w?.nummer && !gesehen.has(w.nummer)) { gesehen.add(w.nummer); gefunden.push(w); }
  }
  if (gefunden.length) return gefunden;

  const doc = await PdfLibDocument.load(daten);
  for (const i of doc.getPageIndices()) {
    const einzel = await PdfLibDocument.create();
    const [seite] = await einzel.copyPages(doc, [i]);
    einzel.addPage(seite);
    const w = werteAusPdf(Buffer.from(await einzel.save()));
    if (w.nummer && !gesehen.has(w.nummer)) { gesehen.add(w.nummer); gefunden.push(w); }
  }
  return gefunden;
}
