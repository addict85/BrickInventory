/**
 * Gutschein-PDFs ändern, verbinden und seitenweise lesen.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 *
 * Marcos Vorgabe: „Gutscheine sollen exportiert werden können inkl. Guthaben.
 * Bitte den Text im Gutschein mit dem in der App hinterlegten Betrag
 * ersetzen. Wenn alle Gutscheine exportiert werden sollen, ein PDF erstellen
 * mit allen Gutscheinen. Das PDF soll auch wieder importiert werden können."
 *
 * Der Betrag auf der Karte ist der AUSGESTELLTE; in der App steht der, der
 * noch drauf ist. Wer den Gutschein weitergibt, will das Papier mit dem
 * heutigen Stand.
 *
 * ── Warum eine Bibliothek, und warum diese ──────────────────────────────────
 *
 * GEMESSEN: `pdfkit` (schon im Baum) kann nur SCHREIBEN — `loadPDF`,
 * `importPage`, `embedPDF` existieren alle nicht. Mehrere Original-PDFs zu
 * einem zu verbinden ist damit nicht schwierig, sondern unmöglich.
 *
 * `@cantoo/pdf-lib` ist die gepflegte Abspaltung von `pdf-lib`: 2.11.1 vom
 * 15.09.2026 gegen 1.17.1 vom 06.11.2021. Reines JavaScript, vier kleine
 * Abhängigkeiten, keine Laufzeit eines Browsers. Marco hat die Aufnahme
 * entschieden, nachdem die Messung oben vorlag.
 *
 * ── Warum ERSETZEN und nicht ÜBERDRUCKEN ────────────────────────────────────
 *
 * Ein weisses Rechteck mit neuer Zahl darüber wäre viel einfacher. Dann stünde
 * aber die ALTE Zahl weiter im Text des PDFs — und der Importer dieser
 * Anwendung liest genau diesen Text. Der Rundlauf läse 400, wo 250 gedruckt
 * steht. Ersetzt wird deshalb im Inhaltsstrom selbst.
 *
 * ── Die Schriftschranke ─────────────────────────────────────────────────────
 *
 * Ersetzt wird eine Zeichenkette durch eine LITERALE (ASCII). Das stimmt nur,
 * wenn die Schrift des Operators ASCII auf sich selbst abbildet. GEMESSEN an
 * zwei von pdfkit erzeugten PDFs:
 *
 *     Standard (Helvetica)     /Type1  Encoding=/WinAnsiEncoding
 *     eingebettete Teilmenge   /Type0  Encoding=/Identity-H
 *
 * Bei Identity-H liest der Leser GAR NICHTS (betrag: null) — über diesen Weg
 * käme also nie ein Betrag zum Ersetzen. Die Schranke macht daraus trotzdem
 * ein „ausgeschlossen" statt eines „unwahrscheinlich": Angefasst wird nur ein
 * Operator, dessen aktive Schrift (das letzte `Tf` davor) eine der drei
 * Standardkodierungen trägt oder gar keine (die vierzehn Standardschriften).
 *
 * Ohne diese Schranke bliebe eine Lage, die keine Nachprüfung fängt: Eine
 * literale Kette in einer Identity-H-Schrift LIEST sich als „250" und DRUCKT
 * sich als Zeichensalat. Prüfung grün, Papier falsch.
 *
 * ── Und trotzdem wird nachgeprüft ───────────────────────────────────────────
 *
 * `ersetzeBetrag()` liest das Ergebnis mit demselben Leser wieder und gibt
 * `null` zurück, wenn nicht genau der neue Betrag herauskommt und Nummer und
 * PIN unverändert sind. Ein nicht ersetzter Gutschein ist eine Auskunft; ein
 * falsch ersetzter wäre eine Falschaussage über Geld.
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
 *
 * Der ganze Operator wird durch eine literale Kette ersetzt — die
 * Kerning-Zahlen eines TJ-Feldes gehen dabei verloren. Der Text sitzt dadurch
 * minimal anders; er steht aber vollständig da, und der Betrag ist der
 * richtige. Die Buchstabenabstände einer Geschenkkarte sind der Preis, den
 * diese Genauigkeit kostet.
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
 *
 * ── Ohne `any`, und warum das hier zählt ────────────────────────────────────
 *
 * Der erste Entwurf nahm `seite: any` und zweimal `(x: any)` in den
 * Rückrufen. test/ratschen.test.js zählt jedes `any` im Baum und lässt die
 * Zahl nur SINKEN („any wird weniger, nie mehr") — 401 statt 398, und die
 * Ratsche hat es gemeldet. Die Typen sind alle da: PDFPage für die Seite,
 * PDFObject für einen Eintrag im Inhalts-Feld. Es war Bequemlichkeit, keine
 * Notwendigkeit.
 *
 * `Contents()` liefert laut Typ einen PDFArray, einen PDFRawStream oder
 * undefined — ein Einzelstrom, ein Feld von Verweisen oder nichts. Alle drei
 * Fälle stehen unten ausdrücklich da.
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
 *
 * ── Warum es sie gibt ───────────────────────────────────────────────────────
 *
 * „Das PDF soll auch wieder importiert werden können (mehrere Seiten in einem
 * PDF ergeben mehrere Gutschein-Einträge)." Ohne Marke müsste der Import jede
 * Seite nach dem Muster durchsuchen, mit dem auch ein fremdes LEGO-PDF gelesen
 * wird — und das ist Raten: Die längste Ziffernfolge ist die Nummer, die Zahl
 * neben einem Währungscode der Betrag. Auf einer Seite geht das; über zwanzig
 * Seiten verschiedener Jahrgänge vervielfacht sich jede Unschärfe.
 *
 * Mit Marke ist der Import eine Ablesung. Das Raten bleibt als RÜCKFALL für
 * fremde PDFs (siehe seitenweiseLesen) — die Marke ersetzt es nicht, sie geht
 * ihm voraus.
 *
 * Die Zeile steht sichtbar klein am unteren Rand und nicht unsichtbar: Was in
 * einem Dokument steht, soll man sehen können. Wer das PDF weitergibt, gibt
 * Nummer und PIN ohnehin weiter — die stehen gross darüber.
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

/** Was aus einem Gutschein im Export geworden ist. */
export interface ExportBefund {
  id: number;
  number: string;
  /** 'ersetzt' | 'unveraendert' | 'erzeugt' */
  art: 'ersetzt' | 'unveraendert' | 'erzeugt';
  /** Warum nicht ersetzt wurde — nur bei 'unveraendert'. */
  grund: string | null;
}

/**
 * Eine Seite für einen Gutschein OHNE Original-PDF.
 *
 * Das ist kein Umgehen von Marcos Entscheidung („Betrag im Original
 * ersetzen"), sondern ein Fall, den sie nicht abdeckt: Ein von Hand erfasster
 * Gutschein hat kein Original, in dem etwas zu ersetzen wäre. Ohne diese Seite
 * fehlte er im Export ganz — und „alle Gutscheine" hiesse dann „alle mit
 * PDF".
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
 *
 * Reihenfolge und Ablauf:
 *   1. Mit Original: Betrag ersetzen. Geht das nicht sicher, kommt das
 *      Original UNVERÄNDERT hinein und der Befund sagt, warum. Ein nicht
 *      ersetzter Gutschein ist eine Auskunft; ein falsch ersetzter wäre eine
 *      Falschaussage über Geld.
 *   2. Ohne Original: erzeugte Seite.
 *   3. Auf JEDE erste Seite eines Gutscheins kommt die Marke, damit der Import
 *      ablesen kann statt zu raten.
 *
 * Die Befunde gehen mit zurück, nicht ins Protokoll: Der Nutzer, der auf
 * „exportieren" geklickt hat, ist der, der es wissen muss.
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
        befunde.push({ id: g.id, number: g.number,
                       art: r.treffer ? 'ersetzt' : 'unveraendert',
                       grund: r.treffer ? null : 'Der Betrag im PDF stimmt schon' });
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
      //
      // GEMESSEN: Dass daraus EIN Eintrag wird, garantiert nicht diese Zeile,
      // sondern die Dublettenprüfung in seitenweiseLesen() — eine Gegenprobe
      // („Marke auf ALLE Seiten") machte keinen Fall rot. Hier stand deshalb
      // zuerst zu viel („sonst zählte der Import mehrfach"). Richtig ist: Die
      // Dublettenprüfung trägt die Aussage, diese Zeile hält das Dokument
      // sauber — zwanzig gleiche Fusszeilen auf einem zwanzigseitigen Original
      // wären Unrat, kein Fehler.
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
 *
 * ── Zwei Wege, und warum in dieser Reihenfolge ──────────────────────────────
 *
 * 1. MARKEN. Ein von dieser Anwendung exportiertes PDF sagt selbst, was drin
 *    steht. Das ist eine Ablesung, kein Schluss.
 * 2. SEITENWEISE RATEN. Ein fremdes PDF (die Karte, wie LEGO sie schickt) hat
 *    keine Marke. Dann wird es in Einzelseiten zerlegt und jede mit
 *    werteAusPdf() gelesen — dasselbe Verfahren wie bisher für eine Seite, nur
 *    für jede. Zerlegen und NICHT das Ganze lesen: Sonst gewinnt über zwanzig
 *    Seiten die längste Ziffernfolge des ganzen Stapels, und es käme EIN
 *    Gutschein heraus statt zwanzig.
 *
 * Doppelte Nummern fallen weg: Ein Stapel, in dem dieselbe Karte zweimal
 * liegt, soll keinen zweiten Eintrag ergeben (die Tabelle hat UNIQUE
 * (user_id, number), aber ein Fehler je Zeile wäre eine schlechtere Auskunft
 * als „einmal gezählt").
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
