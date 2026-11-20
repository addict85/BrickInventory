/** Freitextsuche mit LIKE: `%`, `_` und `\` aus der Eingabe gelten wörtlich,
 * sonst fände ein einzelnes `%` jeden Eintrag. ESCAPE steht ausdrücklich da,
 * damit es nicht an standard_conforming_strings hängt. */
export const LIKE_ESCAPE = ` ESCAPE '\\'`;

export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, z => '\\' + z);
}

/** Das Muster für „enthält“, mit LIKE_ESCAPE hinter dem Vergleich zu benutzen. */
export function containsPattern(text: string): string {
  return `%${likeLiteral(text)}%`;
}
