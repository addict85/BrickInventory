/**
 * Setnummer aus einem PRODUKTTITEL lesen (UPCitemdb).
 * Ausführlich: docs/begruendungen/src/katalog/produkttitel.ts.md#abschnitt
 */

/**
 * Wörter, die eine Zahl als Mengenangabe ausweisen.
 *
 * Die deutschen Formen stehen mit Dativ-Plural da (`teil(?:e|en)?`): „1250
 * Steinen" rutschte durch, weil nur „Steine" abgedeckt war — und seit
 * dreistellige Zahlen zählen, fällt so etwas häufiger auf.
 */
const MENGENWORT = /^\s*(?:x\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\b/i;

/**
 * Stellenzahlen in absteigender Güte. Unbekannte Längen landen dahinter.
 * Muss mit `GUETE` in setNumberCandidates() (Kotlin) übereinstimmen.
 */
export const GUETE = [5, 4, 6, 7, 3];

function gueteIndex(stellen: number): number {
  const i = GUETE.indexOf(stellen);
  // indexOf liefert sonst -1, und die unbekannte Länge gewänne alles.
  return i < 0 ? GUETE.length : i;
}

/**
 * @param titel Produkttitel, wie ihn eine Händlerdatenbank liefert
 * @returns Kandidaten in absteigender Güte; leer, wenn nichts übrig bleibt
 */
export function setnummerKandidaten(titel: string): string[] {
  if (!titel) return [];
  const jahrGrenze = new Date().getFullYear() + 1;

  type Kandidat = { wert: string; mitSuffix: boolean; mitRaute: boolean; jahr: boolean; guete: number };
  const gefunden: Kandidat[] = [];

  // \d{3,7}: drei bis sieben Stellen. Die alte Fassung ging von vier bis
  // sechs — sie sah weder die dreistelligen Altsets noch die siebenstelligen
  // Bestellnummern grosser Sets.
  const muster = /(#\s*)?\b(\d{3,7})(-\d{1,2})?\b/g;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(titel)) !== null) {
    // treffer[2] ist durch das Muster garantiert, TypeScript weiss das unter
    // noUncheckedIndexedAccess nicht — deshalb der ausdrückliche Ausstieg.
    const ziffern = treffer[2];
    if (!ziffern) continue;
    const suffix = treffer[3] ?? '';
    const danach = titel.slice(treffer.index + treffer[0].length);
    if (MENGENWORT.test(danach)) continue;           // Regel 1: Teilezahl
    const zahl = parseInt(ziffern, 10);
    // Mit Variantenzusatz ist es keine Jahreszahl mehr, sondern eine Setnummer
    // in ihrer eindeutigen Schreibweise.
    const jahr = !suffix && ziffern.length === 4 && zahl >= 1949 && zahl <= jahrGrenze;
    gefunden.push({
      wert: ziffern + suffix,
      mitSuffix: !!suffix,
      mitRaute: !!treffer[1],
      jahr,
      guete: gueteIndex(ziffern.length),
    });
  }

  const eindeutig = gefunden.filter((k, i) =>
    gefunden.findIndex(a => a.wert === k.wert) === i);

  // Regeln 2–6. Array.prototype.sort ist stabil, also bleibt bei Gleichstand
  // die Reihenfolge im Titel erhalten.
  return eindeutig
    .slice()
    .sort((a, b) =>
      Number(b.mitSuffix) - Number(a.mitSuffix) ||
      Number(b.mitRaute)  - Number(a.mitRaute)  ||
      Number(a.jahr)      - Number(b.jahr)      ||
      a.guete             - b.guete)
    .map(k => k.wert);
}

