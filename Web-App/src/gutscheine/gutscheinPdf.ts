// Eigener Leser: pdfkit kann nur schreiben.
import zlib from 'node:zlib';

export interface GutscheinWerte {
  nummer: string | null;
  pin: string | null;
  betrag: number | null;
  waehrung: string | null;
}

/** Bewusst geschlossen: Jedes Drei-Buchstaben-Wort fängt „PDF" so gut wie „CHF". */
const WAEHRUNGEN = ['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK'] as const;

/** Ohne zu raten: Eine mehrdeutige Schreibweise bleibt null. */
export function zahlLesen(roh: string): number | null {
  const s = roh.replace(/[\s'’`]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const letzterPunkt = s.lastIndexOf('.');
  const letztesKomma = s.lastIndexOf(',');
  const trenner = Math.max(letzterPunkt, letztesKomma);

  let ganz: string, bruch: string;
  if (trenner === -1) {
    ganz = s;
    bruch = '';
  } else {
    const nach = s.length - trenner - 1;
    // Genau drei Ziffern nach dem einzigen Trenner ist mehrdeutig; einen Gutschein
    // über 1,234 CHF gibt es nicht, einen über 1234 schon — also Tausendertrenner.
    const nurEinTrenner = s.replace(/[.,]/g, '').length === s.length - 1;
    if (nach === 3 && nurEinTrenner) {
      ganz = s.replace(/[.,]/g, '');
      bruch = '';
    } else if (nach > 0 && nach <= 2) {
      ganz = s.slice(0, trenner).replace(/[.,]/g, '');
      bruch = s.slice(trenner + 1);
    } else {
      ganz = s.replace(/[.,]/g, '');
      bruch = '';
    }
  }
  const zahl = Number(bruch ? `${ganz}.${bruch}` : ganz);
  return Number.isFinite(zahl) ? zahl : null;
}

function literalLesen(roh: string): string {
  // \ddd (Oktal), \n \r \t \b \f, \( \) \\ und die Zeilenfortsetzung `\<NL>`.
  return roh.replace(/\\(?:(\d{1,3})|(\r\n|\n|\r)|(.))/g, (_m, oktal, _nl, zeichen) => {
    if (oktal) return String.fromCharCode(parseInt(oktal, 8));
    if (_nl) return '';
    switch (zeichen) {
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
        return zeichen; // \( \) \\ und alles andere woertlich
    }
  });
}

function hexLesen(roh: string): string {
  const hex = roh.replace(/[^0-9A-Fa-f]/g, '');
  const paare = hex.length % 2 ? hex + '0' : hex; // ungerade: mit 0 auffuellen (PDF-Regel)
  let out = '';
  for (let i = 0; i < paare.length; i += 2) out += String.fromCharCode(parseInt(paare.slice(i, i + 2), 16));
  return out;
}

export interface TextOperator {
  von: number;
  bis: number;
  op: string;
  /** Bei TJ sind die Zahlen zwischen den Ketten Abstände, kein Inhalt. */
  text: string;
}

const istHex = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102) || c === 32 || (c >= 9 && c <= 13);
const istLeer = (c: number) => c === 32 || (c >= 9 && c <= 13) || c === 0;

function literalEnde(s: string, i: number): number {
  let tiefe = 0;
  for (let j = i; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 92)
      j++; // Escape
    else if (c === 40)
      tiefe++; // (
    else if (c === 41 && --tiefe === 0) return j + 1; // )
  }
  return -1;
}

function hexEnde(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 62) return j + 1;
    if (!istHex(c)) return -1;
  }
  return -1;
}

/** Ein Lexer statt eines Musters: `(\(\(\(…` ohne Ende kostete mit einem
 * Muster quadratische Zeit. Hier wird jedes Zeichen höchstens zweimal
 * angesehen; Literal-Ketten dürfen paarweise Klammern enthalten. */
export function textOperatoren(s: string): TextOperator[] {
  const aus: TextOperator[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    let ende = -1,
      text = '';
    if (c === 40) {
      // (
      ende = literalEnde(s, i);
      if (ende < 0) break; // nie geschlossen
      text = literalLesen(s.slice(i + 1, ende - 1));
    } else if (c === 60 && s.charCodeAt(i + 1) !== 60) {
      // < aber nicht <<
      ende = hexEnde(s, i);
      if (ende > 0) text = hexLesen(s.slice(i + 1, ende - 1));
    } else if (c === 91) {
      // [
      let j = i + 1;
      while (j < s.length && ende < 0) {
        const d = s.charCodeAt(j);
        if (d === 93) ende = j + 1;
        else if (d === 91) break;
        else if (d === 40) {
          const e = literalEnde(s, j);
          if (e < 0) return aus;
          text += literalLesen(s.slice(j + 1, e - 1));
          j = e;
        } else if (d === 60) {
          const e = hexEnde(s, j);
          if (e < 0) break;
          text += hexLesen(s.slice(j + 1, e - 1));
          j = e;
        } else j++;
      }
    }
    if (ende < 0) {
      i++;
      continue;
    }
    let k = ende;
    while (k < s.length && istLeer(s.charCodeAt(k))) k++;
    const op = ['TJ', 'Tj', "'", '"'].find(o => s.startsWith(o, k));
    if (op) aus.push({ von: i, bis: k + op.length, op, text });
    i = op ? k + op.length : ende;
  }
  return aus;
}

/** Ohne Grenze wurden 299 KB zu 300 MB entpackt. Wer darüber liegt, ist kein
 * Gutschein und kommt auch nicht bis zu pdf-lib, das ohne Grenze entpackt. */
export const STROM_MAX_BYTES = 5 * 1024 * 1024;
export const ENTPACKT_MAX_BYTES = 20 * 1024 * 1024;
export const STROEME_MAX = 2000;

export class PdfZuGross extends Error {}

// Eine Zeile je Operator: Nummer allein.
export function pdfText(daten: Buffer): string {
  const roh = daten.toString('latin1');
  const zeilen: string[] = [];
  let stroeme = 0,
    entpackt = 0;

  // Per indexOf statt faulem Muster: Das lief bei vielen `stream` ohne Ende von
  // jeder Fundstelle bis zum Dateiende.
  for (let ab = 0; ; ) {
    const anfang = roh.indexOf('stream', ab);
    if (anfang < 0) break;
    let start = anfang + 6;
    if (roh[start] === '\r') start++;
    if (roh[start] !== '\n') {
      ab = anfang + 1;
      continue;
    }
    start++;
    const schluss = roh.indexOf('endstream', start);
    if (schluss < 0) break;
    ab = schluss + 9;
    if (++stroeme > STROEME_MAX) throw new PdfZuGross(`mehr als ${STROEME_MAX} Ströme`);

    const strom = Buffer.from(roh.slice(start, schluss), 'latin1');
    let inhalt: string;
    try {
      const flach = zlib.inflateSync(strom, { maxOutputLength: STROM_MAX_BYTES });
      entpackt += flach.length;
      inhalt = flach.toString('latin1');
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
        throw new PdfZuGross(`ein Strom entpackt auf mehr als ${STROM_MAX_BYTES} Bytes`);
      inhalt = strom.toString('latin1');
    }
    if (entpackt > ENTPACKT_MAX_BYTES) throw new PdfZuGross('zu viel entpackter Inhalt');

    for (const t of textOperatoren(inhalt)) if (t.text.trim()) zeilen.push(t.text);
  }
  return zeilen.join('\n');
}

/** Öffentlich, damit sich die Zuordnung „welche Zahl ist was" ohne PDF prüfen lässt. */
export function werteAusText(text: string): GutscheinWerte {
  const w = WAEHRUNGEN.join('|');

  // Erst die Formulierungen, die den Betrag BENENNEN, dann „irgendeine Zahl
  // neben einem Währungscode": Im Kleingedruckten könnte zufällig eine stehen.
  // Alle Wiederholungen beschränkt: Der Text ist fremd, und `\s*` neben
  // `[…\s]+?` kostet bei langen Leerzeilen quadratische Zeit.
  const betragMuster = [
    new RegExp(`im\\s{1,9}Wert\\s{1,9}von\\s{1,9}([\\d'’.,\\s]{1,30}?)\\s{0,9}(${w})\\b`, 'i'),
    new RegExp(`value\\s{1,9}of\\s{1,9}([\\d'’.,\\s]{1,30}?)\\s{0,9}(${w})\\b`, 'i'),
    new RegExp(`\\b([\\d'’.,]{1,30})\\s{0,9}(${w})\\b`),
  ];
  let betrag: number | null = null,
    waehrung: string | null = null;
  for (const muster of betragMuster) {
    const tr = text.match(muster);
    if (tr) {
      betrag = zahlLesen(tr[1] ?? '');
      waehrung = (tr[2] ?? '').toUpperCase();
      if (betrag !== null) break;
    }
  }
  if (betrag === null) {
    const tr = text.match(new RegExp(`\\b(${w})\\s{0,9}([\\d'’.,]{1,30})`, 'i'));
    if (tr) {
      waehrung = (tr[1] ?? '').toUpperCase();
      betrag = zahlLesen(tr[2] ?? '');
    }
  }

  // Am Wort festgemacht, nicht an der Stellung.
  const pinTreffer = text.match(/\bPIN\b\s{0,9}[:.-]?\s{0,9}(\d{3,8})\b/i);
  const pin = pinTreffer ? (pinTreffer[1] ?? null) : null;

  // Die längste Ziffernfolge ab 13 Stellen: Die Grenze hält Jahreszahlen und PIN
  // draussen, „längste" eine Telefonnummer im Kleingedruckten.
  const kandidaten: string[] = text.match(/\d{13,22}/g) ?? [];
  const nummer = kandidaten.length ? kandidaten.reduce((a, b) => (b.length > a.length ? b : a)) : null;

  return { nummer, pin, betrag, waehrung };
}

export function werteAusPdf(daten: Buffer): GutscheinWerte {
  return werteAusText(pdfText(daten));
}
