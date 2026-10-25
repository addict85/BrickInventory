/**
 * Die drei Werte eines LEGO-Gutscheins aus dessen PDF lesen.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdf.ts.md#abschnitt
 */
import zlib from 'zlib';

/** Was aus einem Gutschein-PDF herauszuholen ist. `null` = nicht gefunden. */
export interface GutscheinWerte {
  nummer: string | null;
  pin: string | null;
  betrag: number | null;
  waehrung: string | null;
}

/**
 * Waehrungen, die die Webapp kennt (siehe die Auswahl in public/index.html).
 * Die Liste ist bewusst geschlossen: Ein beliebiges Drei-Buchstaben-Wort als
 * Waehrung zu nehmen, faengt „CHF" genauso wie „PDF" oder „LEGO".
 */
const WAEHRUNGEN = ['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK'] as const;

/**
 * Eine Zahl aus dem PDF in eine Zahl verwandeln — ohne zu raten.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdf.ts.md#zahllesen
 */
export function zahlLesen(roh: string): number | null {
  const s = roh.replace(/[\s'’`]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const letzterPunkt = s.lastIndexOf('.');
  const letztesKomma = s.lastIndexOf(',');
  const trenner = Math.max(letzterPunkt, letztesKomma);

  let ganz: string, bruch: string;
  if (trenner === -1) {
    ganz = s; bruch = '';
  } else {
    const nach = s.length - trenner - 1;
    // Genau drei Ziffern dahinter UND kein weiteres Trennzeichen davor:
    // mehrdeutig (1.234 kann 1234 oder 1,234 sein). Der Baum rechnet in
    // ganzen Waehrungseinheiten mit Rappen — ein Gutschein ueber 1,234 CHF
    // gibt es nicht, einer ueber 1234 CHF schon. Also Tausendertrenner.
    const nurEinTrenner = s.replace(/[.,]/g, '').length === s.length - 1;
    if (nach === 3 && nurEinTrenner) { ganz = s.replace(/[.,]/g, ''); bruch = ''; }
    else if (nach > 0 && nach <= 2) { ganz = s.slice(0, trenner).replace(/[.,]/g, ''); bruch = s.slice(trenner + 1); }
    else { ganz = s.replace(/[.,]/g, ''); bruch = ''; }
  }
  const zahl = Number(bruch ? `${ganz}.${bruch}` : ganz);
  return Number.isFinite(zahl) ? zahl : null;
}

/** Eine PDF-Zeichenkette `(…)` entpacken: Escapes aufloesen, Rest woertlich. */
function literalLesen(roh: string): string {
  // \ddd (Oktal), \n \r \t \b \f, \( \) \\ und die Zeilenfortsetzung `\<NL>`.
  return roh.replace(/\\(?:(\d{1,3})|(\r\n|\n|\r)|(.))/g, (_m, oktal, _nl, zeichen) => {
    if (oktal) return String.fromCharCode(parseInt(oktal, 8));
    if (_nl) return '';
    switch (zeichen) {
      case 'n': return '\n'; case 'r': return '\r'; case 't': return '\t';
      case 'b': return '\b'; case 'f': return '\f';
      default:  return zeichen;   // \( \) \\ und alles andere woertlich
    }
  });
}

/** Eine PDF-Hexzeichenkette `<4A6F>` entpacken. */
function hexLesen(roh: string): string {
  const hex = roh.replace(/[^0-9A-Fa-f]/g, '');
  const paare = hex.length % 2 ? hex + '0' : hex;     // ungerade: mit 0 auffuellen (PDF-Regel)
  let out = '';
  for (let i = 0; i < paare.length; i += 2) out += String.fromCharCode(parseInt(paare.slice(i, i + 2), 16));
  return out;
}

/**
 * Den sichtbaren Text eines PDFs herausholen.
 * Ausführlich: docs/begruendungen/utils/gutscheinPdf.ts.md#abschnitt-2
 */
/**
 * Ein Textoperator im Inhaltsstrom: (…)Tj, […]TJ, (…)' und (…)".
 * Ausführlich: docs/begruendungen/utils/gutscheinPdf.ts.md#text-op-re
 */
export const TEXT_OP_RE =
  /(\[(?:[^\][\\]|\\[\s\S])*\]|\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>)\s*(TJ|Tj|'|")/g;

/**
 * Der LOGISCHE Text eines Textoperator-Arguments.
 *
 * TJ-Array: Zeichenketten und Kerning-Zahlen im Wechsel. Die Zahlen sind
 * Abstände, kein Inhalt — sie fliegen raus, die Ketten werden aneinander­
 * gehängt. Genau so entsteht aus den Bruchstücken wieder „Ihre
 * LEGO-Geschenkkarte im Wert von 400 CHF:".
 */
export function operatorText(arg: string): string {
  if (arg.startsWith('[')) {
    let text = '';
    const teilRe = /\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>/g;
    let teil: RegExpExecArray | null;
    while ((teil = teilRe.exec(arg)) !== null) {
      text += teil[0].startsWith('<')
        ? hexLesen(teil[0].slice(1, -1))
        : literalLesen(teil[0].slice(1, -1));
    }
    return text;
  }
  return arg.startsWith('<') ? hexLesen(arg.slice(1, -1)) : literalLesen(arg.slice(1, -1));
}

export function pdfText(daten: Buffer): string {
  const roh = daten.toString('latin1');
  const zeilen: string[] = [];

  // `stream` … `endstream`. Nicht gierig, damit zwei Stroeme nicht zu einem
  // werden; [\s\S] statt `.`, weil Strominhalt Zeilenumbrueche enthaelt.
  const stromRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = stromRe.exec(roh)) !== null) {
    let inhalt: string;
    try {
      inhalt = zlib.inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      // Kein FlateDecode (Bilder sind DCTDecode, der Rest kann unkomprimiert
      // sein). Unkomprimierte Inhaltsstroeme sind direkt lesbar, also NICHT
      // ueberspringen — nur bei Binaermuell faellt unten ohnehin nichts an.
      inhalt = m[1] ?? '';
    }

    let t: RegExpExecArray | null;
    TEXT_OP_RE.lastIndex = 0;
    while ((t = TEXT_OP_RE.exec(inhalt)) !== null) {
      const text = operatorText(t[1] ?? '');
      if (text.trim()) zeilen.push(text);
    }
  }
  return zeilen.join('\n');
}

/**
 * Die drei Werte aus dem Text eines Gutscheins herausholen.
 *
 * Oeffentlich, damit sie sich ohne PDF pruefen laesst — die Zuordnung „welche
 * Zahl ist was" ist der Teil, der schiefgehen kann, und der gehoert einzeln
 * messbar.
 */
export function werteAusText(text: string): GutscheinWerte {
  const w = WAEHRUNGEN.join('|');

  // ── Betrag und Waehrung ──────────────────────────────────────────────────
  //
  // Erst die Formulierungen, die den Betrag BENENNEN (deutsch und englisch),
  // danach erst „irgendeine Zahl neben einem Waehrungscode". Die Reihenfolge
  // ist der Schutz: Im Kleingedruckten steht „LEGO.com/gift-cards" und noch
  // einiges mehr, und irgendwo dort koennte zufaellig eine Zahl neben einem
  // Code stehen. Die benannte Stelle ist die verlaessliche.
  const betragMuster = [
    new RegExp(`im\\s+Wert\\s+von\\s+([\\d'’.,\\s]+?)\\s*(${w})\\b`, 'i'),
    new RegExp(`value\\s+of\\s+([\\d'’.,\\s]+?)\\s*(${w})\\b`, 'i'),
    new RegExp(`\\b([\\d'’.,]+)\\s*(${w})\\b`),
  ];
  let betrag: number | null = null, waehrung: string | null = null;
  for (const muster of betragMuster) {
    const tr = text.match(muster);
    if (tr) { betrag = zahlLesen(tr[1] ?? ''); waehrung = (tr[2] ?? '').toUpperCase(); if (betrag !== null) break; }
  }
  // Waehrung VOR dem Betrag („CHF 400") — nur falls oben nichts kam.
  if (betrag === null) {
    const tr = text.match(new RegExp(`\\b(${w})\\s*([\\d'’.,]+)`, 'i'));
    if (tr) { waehrung = (tr[1] ?? '').toUpperCase(); betrag = zahlLesen(tr[2] ?? ''); }
  }

  // ── PIN ──────────────────────────────────────────────────────────────────
  //
  // Am Wort festgemacht, nicht an der Stellung. „PIN" heisst im Englischen
  // genauso; dazwischen darf ein Doppelpunkt oder Leerraum stehen.
  const pinTreffer = text.match(/\bPIN\b\s*[:.\-]?\s*(\d{3,8})\b/i);
  const pin = pinTreffer ? (pinTreffer[1] ?? null) : null;

  // Kartennummer
  // Die laengste zusammenhaengende Ziffernfolge ab 13 Stellen. Die untere
  // Grenze haelt Jahreszahlen, Postleitzahlen und den PIN draussen; „laengste"
  // statt „erste", damit eine Telefonnummer im Kleingedruckten die echte …
  // Ausführlich: docs/begruendungen/utils/gutscheinPdf.ts.md#werteaustext-kandidaten
  const kandidaten: string[] = text.match(/\d{13,22}/g) ?? [];
  const nummer = kandidaten.length
    ? kandidaten.reduce((a, b) => (b.length > a.length ? b : a))
    : null;

  return { nummer, pin, betrag, waehrung };
}

/** Beides zusammen: PDF rein, Werte raus. */
export function werteAusPdf(daten: Buffer): GutscheinWerte {
  return werteAusText(pdfText(daten));
}
