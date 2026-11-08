// Die Setnummer aus einem Händlertitel, nicht die erste Zahl darin (Jahr, Teilezahl).
// Ausführlich: docs/begruendungen/src/katalog/produkttitel.ts.md#abschnitt

/** Die deutschen Formen mit Dativ-Plural: „1250 Steinen" rutschte sonst durch. */
const MENGENWORT = /^\s*(?:x\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\b/i;

/** Muss mit `GUETE` in setNumberCandidates() (Kotlin) übereinstimmen. */
export const GUETE = [5, 4, 6, 7, 3];

function gueteIndex(stellen: number): number {
  const i = GUETE.indexOf(stellen);
  // indexOf liefert sonst -1, und die unbekannte Länge gewänne alles.
  return i < 0 ? GUETE.length : i;
}

/** @returns Kandidaten in absteigender Güte; leer, wenn nichts übrig bleibt */
export function setnummerKandidaten(titel: string): string[] {
  if (!titel) return [];
  const jahrGrenze = new Date().getFullYear() + 1;

  type Kandidat = { wert: string; mitSuffix: boolean; mitRaute: boolean; jahr: boolean; guete: number };
  const gefunden: Kandidat[] = [];

  // Drei bis sieben Stellen: dreistellige Altsets und siebenstellige
  // Bestellnummern grosser Sets.
  const muster = /(#\s*)?\b(\d{3,7})(-\d{1,2})?\b/g;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(titel)) !== null) {
    // Unter noUncheckedIndexedAccess weiss TypeScript nicht, dass das Muster
    // treffer[2] garantiert.
    const ziffern = treffer[2];
    if (!ziffern) continue;
    const suffix = treffer[3] ?? '';
    const danach = titel.slice(treffer.index + treffer[0].length);
    if (MENGENWORT.test(danach)) continue;           // Regel 1: Teilezahl
    const zahl = parseInt(ziffern, 10);
    // Mit Variantenzusatz ist es keine Jahreszahl mehr, sondern eine Setnummer.
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

  // Array.prototype.sort ist stabil: Bei Gleichstand bleibt die Reihenfolge im Titel.
  return eindeutig
    .slice()
    .sort((a, b) =>
      Number(b.mitSuffix) - Number(a.mitSuffix) ||
      Number(b.mitRaute)  - Number(a.mitRaute)  ||
      Number(a.jahr)      - Number(b.jahr)      ||
      a.guete             - b.guete)
    .map(k => k.wert);
}

