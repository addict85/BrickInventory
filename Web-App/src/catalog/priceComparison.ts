/** The provider. One line, on purpose: that way it can be swapped in one place. */
const BASIS = 'https://www.toppreise.ch/produktsuche?q=';

/** A SEARCH, not a product page: for the price comparison site the set number
 * is not a key, and which spelling it uses only it knows. */
export function suchUrl(begriff: string): string {
  const q = String(begriff ?? '').trim();
  if (!q) return '';
  return BASIS + encodeURIComponent(q);
}

/** Number AND name: "75192-1" alone often finds nothing. The variant "-1" is
 * a Rebrickable peculiarity and appears on no packaging. */
export function forSet(setNumber: string, name?: string | null): string {
  const nummer = String(setNumber ?? '')
    .replace(/-\d+$/, '')
    .trim();
  if (!nummer) return '';
  return suchUrl(['LEGO', nummer, String(name ?? '').trim()].filter(Boolean).join(' '));
}
