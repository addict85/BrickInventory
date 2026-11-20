// Die Setnummer aus einem Händlertitel, nicht die erste Zahl darin (Jahr, Teilezahl).

/** Die deutschen Formen mit Dativ-Plural: „1250 Steinen" rutschte sonst durch. */
const QUANTITY_WORD =
  /^\s*(?:x\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\b/i;

/** Muss mit `QUALITY` in setNumberCandidates() (Kotlin) übereinstimmen. */
export const QUALITY = [5, 4, 6, 7, 3];

function qualityIndex(stellen: number): number {
  const i = QUALITY.indexOf(stellen);
  // indexOf liefert sonst -1, und die unbekannte Länge gewänne alles.
  return i < 0 ? QUALITY.length : i;
}

/** `jahr`: das laufende; eine Zahl darüber hinaus ist kein Erscheinungsjahr.
 * @returns Kandidaten in absteigender Güte; leer, wenn nichts übrig bleibt */
export function setnummerCandidates(titel: string, jahr: number): string[] {
  if (!titel) return [];
  const yearLimit = jahr + 1;

  type Candidate = { wert: string; withSuffix: boolean; withHash: boolean; jahr: boolean; quality: number };
  const gefunden: Candidate[] = [];

  // Drei bis sieben Stellen: dreistellige Altsets und siebenstellige
  // Bestellnummern grosser Sets.
  const muster = /(#\s*)?\b(\d{3,7})(-\d{1,2})?\b/g;
  for (let treffer = muster.exec(titel); treffer !== null; treffer = muster.exec(titel)) {
    // Unter noUncheckedIndexedAccess weiss TypeScript nicht, dass das Muster
    // treffer[2] garantiert.
    const digits = treffer[2];
    if (!digits) continue;
    const suffix = treffer[3] ?? '';
    const danach = titel.slice(treffer.index + treffer[0].length);
    if (QUANTITY_WORD.test(danach)) continue; // Regel 1: Teilezahl
    const zahl = parseInt(digits, 10);
    // Mit Variantenzusatz ist es keine Jahreszahl mehr, sondern eine Setnummer.
    const jahr = !suffix && digits.length === 4 && zahl >= 1949 && zahl <= yearLimit;
    gefunden.push({
      wert: digits + suffix,
      withSuffix: !!suffix,
      withHash: !!treffer[1],
      jahr,
      quality: qualityIndex(digits.length),
    });
  }

  const eindeutig = gefunden.filter((k, i) => gefunden.findIndex(a => a.wert === k.wert) === i);

  // Array.prototype.sort ist stabil: Bei Gleichstand bleibt die Reihenfolge im Titel.
  return eindeutig
    .slice()
    .sort(
      (a, b) =>
        Number(b.withSuffix) - Number(a.withSuffix) ||
        Number(b.withHash) - Number(a.withHash) ||
        Number(a.jahr) - Number(b.jahr) ||
        a.quality - b.quality,
    )
    .map(k => k.wert);
}
