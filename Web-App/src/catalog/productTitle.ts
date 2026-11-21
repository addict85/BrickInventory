// The set number from a retailer's title, not the first number in it (year, part count).

/** The German forms with dative plural: "1250 Steinen" would otherwise slip through. */
const QUANTITY_WORD =
  /^\s*(?:x\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\b/i;

/** Must match `QUALITY` in setNumberCandidates() (Kotlin). */
export const QUALITY = [5, 4, 6, 7, 3];

function qualityIndex(stellen: number): number {
  const i = QUALITY.indexOf(stellen);
  // indexOf would otherwise return -1, and the unknown length would win everything.
  return i < 0 ? QUALITY.length : i;
}

/** `jahr`: the current one; a number beyond it is not a release year.
 * @returns candidates in descending quality; empty if nothing remains */
export function setnummerCandidates(titel: string, jahr: number): string[] {
  if (!titel) return [];
  const yearLimit = jahr + 1;

  type Candidate = { wert: string; withSuffix: boolean; withHash: boolean; jahr: boolean; quality: number };
  const gefunden: Candidate[] = [];

  // Three to seven digits: three-digit old sets and seven-digit
  // order numbers of large sets.
  const muster = /(#\s*)?\b(\d{3,7})(-\d{1,2})?\b/g;
  for (let treffer = muster.exec(titel); treffer !== null; treffer = muster.exec(titel)) {
    // Under noUncheckedIndexedAccess TypeScript does not know that the pattern
    // guarantees treffer[2].
    const digits = treffer[2];
    if (!digits) continue;
    const suffix = treffer[3] ?? '';
    const danach = titel.slice(treffer.index + treffer[0].length);
    if (QUANTITY_WORD.test(danach)) continue; // Rule 1: part count
    const zahl = parseInt(digits, 10);
    // With a variant suffix it is no longer a year but a set number.
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

  // Array.prototype.sort is stable: on a tie the order in the title stays.
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
