/** Free text search with LIKE: `%`, `_` and `\` from the input are literal,
 * otherwise a single `%` would find every entry. ESCAPE is spelled out
 * so it does not depend on standard_conforming_strings. */
export const LIKE_ESCAPE = ` ESCAPE '\\'`;

export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, z => '\\' + z);
}

/** The pattern for "contains", to be used with LIKE_ESCAPE after the comparison. */
export function containsPattern(text: string): string {
  return `%${likeLiteral(text)}%`;
}
