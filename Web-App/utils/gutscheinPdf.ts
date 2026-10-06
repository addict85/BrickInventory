/**
 * Die drei Werte eines LEGO-Gutscheins aus dessen PDF lesen.
 *
 * ── Warum das hier steht und nicht in einer Bibliothek ──────────────────────
 *
 * Der Baum hat `pdfkit` — das SCHREIBT PDFs und kann keines lesen. Zum Lesen
 * gibt es hier nichts, und eine neue Abhaengigkeit fuer diese eine Aufgabe
 * waere zu viel: Die PDF-Leser im npm-Oekosystem bringen entweder eine ganze
 * Browser-Laufzeit mit (pdfjs-dist) oder sind unbetreut.
 *
 * Entscheidend fuer diese Abwaegung ist, dass der Auszug eine BEQUEMLICHKEIT
 * ist, kein tragender Weg: Marcos Vorgabe nennt die manuelle Erfassung
 * gleichberechtigt zuerst. Schlaegt das Auslesen fehl, sagt die Oberflaeche
 * das und der Nutzer tippt drei Felder. Deshalb darf dieser Auszug schmal
 * sein — er muss nur ehrlich scheitern.
 *
 * ── Was GEMESSEN wurde ──────────────────────────────────────────────────────
 *
 * An Marcos Beispiel-PDF (06.10., 210'802 Bytes, PDF 1.7): eine Seite, vier
 * Bilder, fuenf Schriften, neun Stroeme, davon acht mit zlib entpackbar, und
 * 24 Textoperatoren. Es ist KEIN Scan — die Werte stehen als Text da:
 *
 *     'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:'
 *     '5045076374450011166'
 *     'PIN: 5225'
 *
 * Deshalb reicht Entpacken + Textoperatoren lesen, und es braucht keine
 * Texterkennung. Waere es ein Scan, saehe die Antwort anders aus (die
 * Android-App haette mit ML-Kit eine, der Server nicht).
 *
 * ── Was dieser Leser NICHT kann ─────────────────────────────────────────────
 *
 * Er versteht Stroeme mit FlateDecode und sonst nichts; verschachtelte
 * Klammern in Zeichenketten zaehlt er nicht mit; Objektstroeme (PDF 1.5+,
 * /ObjStm) mit darin versteckten Seiteninhalten sieht er nicht; und eine
 * Schrift mit eigener Kodierung liefert Buchstabensalat statt Text.
 *
 * Jeder dieser Faelle endet in `null` — also im manuellen Weg. Das ist der
 * Grund, warum hier nichts geraten wird: Ein falsch ausgelesener Gutschein
 * ist schlimmer als ein nicht ausgelesener, weil niemand ihn nachprueft.
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
 *
 * Drei Schreibweisen kommen vor und widersprechen einander:
 *   1'234.50   (Schweiz)      1.234,50   (Deutschland)      1,234.50   (USA)
 *
 * Der Apostroph ist immer ein Tausendertrenner. Punkt und Komma sind es
 * NICHT immer — deshalb entscheidet die Stellung: Was zuletzt kommt und
 * hoechstens zwei Ziffern hinter sich hat, ist das Dezimalzeichen; alles
 * andere ist Trennung. Steht ein Trenner mit genau drei Ziffern dahinter und
 * es gibt keinen zweiten Kandidaten, ist es ein Tausendertrenner (1.234).
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
 *
 * Jeder Textoperator wird zu einer eigenen Zeile. Das ist kein Schoenheits-
 * fehler, sondern Absicht: Im Beispiel steht die Kartennummer ALLEIN in einem
 * Operator. Wuerde alles zu einem Fliesstext verklebt, grenzte sie an den
 * Doppelpunkt der Zeile davor und an „PIN" dahinter — und jede Suche muesste
 * raten, wo sie anfaengt.
 */
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

    // Textoperatoren: (…)Tj, […]TJ, (…)' und (…)"
    const opRe = /(\[(?:[^\][\\]|\\[\s\S])*\]|\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>)\s*(TJ|Tj|'|")/g;
    let t: RegExpExecArray | null;
    while ((t = opRe.exec(inhalt)) !== null) {
      const arg = t[1] ?? '';
      let text = '';
      if (arg.startsWith('[')) {
        // TJ-Array: Zeichenketten und Kerning-Zahlen im Wechsel. Die Zahlen
        // sind Abstaende, kein Inhalt — sie fliegen raus, die Ketten werden
        // aneinandergehaengt. Genau so entsteht aus den Bruchstuecken wieder
        // „Ihre LEGO-Geschenkkarte im Wert von 400 CHF:".
        const teilRe = /\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>/g;
        let teil: RegExpExecArray | null;
        while ((teil = teilRe.exec(arg)) !== null) {
          text += teil[0].startsWith('<') ? hexLesen(teil[0].slice(1, -1)) : literalLesen(teil[0].slice(1, -1));
        }
      } else if (arg.startsWith('<')) {
        text = hexLesen(arg.slice(1, -1));
      } else {
        text = literalLesen(arg.slice(1, -1));
      }
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

  // ── Kartennummer ─────────────────────────────────────────────────────────
  //
  // Die laengste zusammenhaengende Ziffernfolge ab 13 Stellen. Die untere
  // Grenze haelt Jahreszahlen, Postleitzahlen und den PIN draussen; „laengste"
  // statt „erste", damit eine Telefonnummer im Kleingedruckten die echte
  // Nummer nicht verdraengt. GEMESSEN am Beispiel: 19 Stellen.
  //
  // Hier stand `.filter(k => k !== pin)` mit der Begruendung, der PIN duerfe
  // nicht zur Nummer werden. ENTFALLEN, weil es nie greifen konnte: Der
  // PIN-Ausdruck oben faengt hoechstens acht Ziffern, ein Kandidat hat
  // mindestens dreizehn — die beiden Mengen beruehren sich nicht. Eine
  // Pruefung, die nicht ausloesen kann, sieht nach Sorgfalt aus und ist
  // keine; getrennt werden die beiden allein durch die Laenge.
  //
  // Aufgefallen bei der Gegenprobe zu dieser Datei, nicht beim Schreiben.
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
