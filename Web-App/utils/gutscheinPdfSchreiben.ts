/**
 * Gutschein-PDFs ändern, verbinden und seitenweise lesen.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#abschnitt
 */
import {
  PDFDocument as PdfLibDocument, PDFArray, PDFDict, PDFName, PDFRawStream,
  decodePDFRawStream, PDFPage, PDFObject,
} from '@cantoo/pdf-lib';
import { werteAusPdf, pdfText, TEXT_OP_RE, operatorText } from './gutscheinPdf';
import type { GutscheinWerte } from './gutscheinPdf';

/**
 * Kodierungen, bei denen eine literale ASCII-Kette das druckt, was sie sagt.
 *
 * Fehlt /Encoding ganz, ist es eine der vierzehn Standardschriften mit
 * StandardEncoding — dort gilt dasselbe für den druckbaren ASCII-Bereich.
 */
const SICHERE_KODIERUNGEN = new Set([
  'WinAnsiEncoding', 'MacRomanEncoding', 'StandardEncoding', 'PDFDocEncoding',
]);

/** Eine literale PDF-Zeichenkette aus Text. */
function alsLiteral(text: string): string {
  return '(' + text.replace(/([()\\])/g, '\\$1') + ')';
}

/**
 * Trägt die Schrift mit diesem Namen eine sichere Kodierung?
 *
 * Unbekannt heisst NEIN: Eine Schrift, die sich nicht nachsehen lässt, wird
 * nicht angefasst.
 */
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
  // Type0 ist zusammengesetzt (CID). Dort steht der Text als Glyphennummern,
  // und eine literale ASCII-Kette hat damit nichts zu tun.
  if (subtype !== undefined && String(subtype) === '/Type0') return false;

  const enc = font.get(PDFName.of('Encoding'));
  if (enc === undefined) return true;                        // Standardschrift
  const roh = String(enc);
  if (!roh.startsWith('/')) return false;                    // Wörterbuch mit /Differences
  return SICHERE_KODIERUNGEN.has(roh.slice(1));
}

/**
 * In EINEM Inhaltsstrom jeden Textoperator ersetzen, der `suchen` enthält.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#ersetzeimstrom
 */
function ersetzeImStrom(inhalt: string, suchen: string, ersetzen: string,
                        sicher: (schrift: string) => boolean):
                        { aus: string; treffer: number; abgelehnt: number } {
  let treffer = 0, abgelehnt = 0;
  TEXT_OP_RE.lastIndex = 0;
  const aus = inhalt.replace(TEXT_OP_RE, (ganz, arg: string, op: string, pos: number) => {
    const logisch = operatorText(arg);
    if (!logisch.includes(suchen)) return ganz;

    // Die AKTIVE Schrift: das letzte `/Name <groesse> Tf` vor dieser Stelle.
    // Ohne Tf gibt es keine Schrift, die sich nachsehen liesse — also nicht
    // anfassen.
    const davor = inhalt.slice(0, pos);
    const tf = davor.match(/\/([^\s/<>\][(){}]+)\s+[\d.+-]+\s+Tf(?![\s\S]*\bTf\b)/);
    if (!tf || !sicher(tf[1] ?? '')) { abgelehnt++; return ganz; }

    treffer++;
    // TJ wird zu Tj: Ein einzelnes Argument ist kein Feld mehr.
    return alsLiteral(logisch.split(suchen).join(ersetzen)) + ' ' + (op === 'TJ' ? 'Tj' : op);
  });
  return { aus, treffer, abgelehnt };
}

/**
 * Die Inhaltsströme einer Seite, aufgelöst.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#stroemevon
 */
function stroemeVon(doc: PdfLibDocument, seite: PDFPage): PDFRawStream[] {
  const c = seite.node.Contents();
  if (c === undefined) return [];
  const liste: unknown[] = c instanceof PDFArray
    ? c.asArray().map((r: PDFObject) => doc.context.lookup(r))
    : [c];
  return liste.filter((s): s is PDFRawStream => s instanceof PDFRawStream);
}

export interface ErsetzBefund {
  /** Das geänderte PDF — null, wenn nicht sicher ersetzt werden konnte. */
  daten: Buffer | null;
  /** Wie viele Textoperatoren geändert wurden. */
  treffer: number;
  /** Wie viele den Betrag trugen, aber eine unsichere Schrift hatten. */
  abgelehnt: number;
  /** Warum es nicht ging — null bei Erfolg. */
  grund: string | null;
}

/**
 * Den Betrag im Original-PDF durch den der App ersetzen.
 *
 * @param daten       das Original
 * @param neuerBetrag der Stand aus der App
 */
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

  // Wie der alte Betrag im PDF GESCHRIEBEN steht, nicht wie er gerechnet
  // wird: „400", „1'234.50", „1.234,50". Gesucht wird die Schreibweise, denn
  // die steht im Strom.
  const text = pdfText(daten);
  const geschrieben = text.match(/[\d'’.,]+(?=\s*(?:CHF|EUR|USD|GBP|SEK|NOK|AUD|CAD|DKK)\b)/i)?.[0]
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
      // Der Strom liegt jetzt UNKOMPRIMIERT da. Ohne das Entfernen von
      // /Filter wuerde jeder Leser versuchen, Klartext zu entpacken.
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

  // ── Die Nachpruefung ─────────────────────────────────────────────────────
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

/**
 * Die Marke, mit der ein exportiertes PDF sich selbst erklärt.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#marke-kopf
 */
const MARKE_KOPF = 'BIM-GUTSCHEIN v1';

/** Eine Marke bauen. Trennzeichen ist das Semikolon, weil Notizen Kommas haben. */
export function markeText(w: { nummer: string; pin: string | null; betrag: number;
                               waehrung: string }): string {
  return `${MARKE_KOPF} nummer=${w.nummer}; pin=${w.pin ?? ''}; `
       + `betrag=${w.betrag.toFixed(2)}; waehrung=${w.waehrung}`;
}

/** Eine Marke lesen. `null`, wenn die Zeile keine ist. */
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

/** Ein Gutschein, wie der Export ihn entgegennimmt. */
export interface ExportGutschein {
  id: number;
  number: string;
  pin: string | null;
  amount: number;
  currency: string;
  /** Das gespeicherte Original, oder null bei rein manueller Erfassung. */
  pdf: Buffer | null;
}

/**
 * Was aus einem Gutschein im Export geworden ist.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#exportbefund
 */
export interface ExportBefund {
  id: number;
  number: string;
  /**
   * 'ersetzt'      — der Betrag im Original wurde auf den Stand der App gesetzt
   * 'stimmte_schon' — es stand schon der richtige Betrag drin (kein Eingriff)
   * 'unveraendert' — es haette ersetzt werden muessen und ging NICHT (mit Grund)
   * 'erzeugt'      — kein Original vorhanden, die Seite wurde gebaut
   */
  art: 'ersetzt' | 'stimmte_schon' | 'unveraendert' | 'erzeugt';
  /** Warum nicht ersetzt wurde — nur bei 'unveraendert'. */
  grund: string | null;
}

/**
 * Eine Seite für einen Gutschein OHNE Original-PDF.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#erzeugeseite
 */
async function erzeugeSeite(g: ExportGutschein): Promise<Buffer> {
  const { StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const doc = await PdfLibDocument.create();
  const seite = doc.addPage([595, 842]);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const grau = rgb(0.45, 0.45, 0.45);

  seite.drawText('Geschenkkarte', { x: 60, y: 760, size: 22, font: fett });
  // Der Satz ist WOERTLICH der des Originals („im Wert von … CHF:"), damit ein
  // fremder Leser — und der Rueckfall in seitenweiseLesen — ihn genauso
  // findet wie auf einer echten Karte.
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

/**
 * Alle Gutscheine in EIN PDF — eine Seite (oder mehrere) je Gutschein.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#verbindegutscheine
 */
export async function verbindeGutscheine(gutscheine: ExportGutschein[]):
    Promise<{ daten: Buffer; befunde: ExportBefund[] }> {
  const { StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const ziel = await PdfLibDocument.create();
  const marke = await ziel.embedFont(StandardFonts.Helvetica);
  const befunde: ExportBefund[] = [];

  for (const g of gutscheine) {
    let quelle: Buffer;
    if (g.pdf) {
      const r = await ersetzeBetrag(g.pdf, g.amount);
      if (r.daten) {
        quelle = r.daten;
        // Kein Treffer heisst hier NICHT „gescheitert": ersetzeBetrag hat die
        // Datei zurueckgegeben, nur stand der gesuchte Betrag schon drin.
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
      // Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#verbindegutscheine-2
      if (i === 0) {
        s.drawText(markeText({ nummer: g.number, pin: g.pin, betrag: g.amount,
                               waehrung: g.currency }),
          { x: 28, y: 18, size: 6, font: marke, color: rgb(0.45, 0.45, 0.45) });
      }
    });
  }

  return { daten: Buffer.from(await ziel.save()), befunde };
}

/**
 * Ein PDF in Gutscheine zerlegen — Marken zuerst, Raten als Rückfall.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdfSchreiben.ts.md#seitenweiselesen
 */
export async function seitenweiseLesen(daten: Buffer): Promise<GutscheinWerte[]> {
  const gefunden: GutscheinWerte[] = [];
  const gesehen = new Set<string>();

  // ── 1. Marken ────────────────────────────────────────────────────────────
  for (const zeile of pdfText(daten).split('\n')) {
    const w = markeLesen(zeile);
    if (w?.nummer && !gesehen.has(w.nummer)) { gesehen.add(w.nummer); gefunden.push(w); }
  }
  if (gefunden.length) return gefunden;

  // ── 2. Seitenweise ───────────────────────────────────────────────────────
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
