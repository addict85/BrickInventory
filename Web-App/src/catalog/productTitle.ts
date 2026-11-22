// The set number from a retailer's title, not the first number in it (year, part count).

/** The German forms with dative plural: "1250 Steinen" would otherwise slip through. */
const QUANTITY_WORD =
  /^\s*(?:x\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\b/i;

/** Must match `QUALITY` in setNumberCandidates() (Kotlin). */
export const QUALITY = [5, 4, 6, 7, 3];

function qualityIndex(places: number): number {
  const i = QUALITY.indexOf(places);
  // indexOf would otherwise return -1, and the unknown length would win everything.
  return i < 0 ? QUALITY.length : i;
}

/** `jahr`: the current one; a number beyond it is not a release year.
 * @returns candidates in descending quality; empty if nothing remains */
export function setNumberCandidates(title: string, jahr: number): string[] {
  if (!title) return [];
  const yearLimit = jahr + 1;

  type Candidate = { wert: string; withSuffix: boolean; withHash: boolean; jahr: boolean; quality: number };
  const found: Candidate[] = [];

  // Three to seven digits: three-digit old sets and seven-digit
  // order numbers of large sets.
  const muster = /(#\s*)?\b(\d{3,7})(-\d{1,2})?\b/g;
  for (let hits = muster.exec(title); hits !== null; hits = muster.exec(title)) {
    // Under noUncheckedIndexedAccess TypeScript does not know that the pattern
    // guarantees treffer[2].
    const digits = hits[2];
    if (!digits) continue;
    const suffix = hits[3] ?? '';
    const after = title.slice(hits.index + hits[0].length);
    if (QUANTITY_WORD.test(after)) continue; // Rule 1: part count
    const number = parseInt(digits, 10);
    // With a variant suffix it is no longer a year but a set number.
    const jahr = !suffix && digits.length === 4 && number >= 1949 && number <= yearLimit;
    found.push({
      wert: digits + suffix,
      withSuffix: !!suffix,
      withHash: !!hits[1],
      jahr,
      quality: qualityIndex(digits.length),
    });
  }

  const unique = found.filter((k, i) => found.findIndex(a => a.wert === k.wert) === i);

  // Array.prototype.sort is stable: on a tie the order in the title stays.
  return unique
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
