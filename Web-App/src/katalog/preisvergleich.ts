
/** Der Anbieter. Eine Zeile, absichtlich: So ist er an einer Stelle tauschbar. */
const BASIS = 'https://www.toppreise.ch/produktsuche?q=';

/** Eine SUCHE, keine Produktseite: Die Setnummer ist beim Preisvergleicher
 * kein Schlüssel, und welche Schreibweise er führt, weiss nur er. */
export function suchUrl(begriff: string): string {
  const q = String(begriff ?? '').trim();
  if (!q) return '';
  return BASIS + encodeURIComponent(q);
}

/** Nummer UND Name: „75192-1" allein findet oft nichts. Die Variante „-1" ist
 * eine Rebrickable-Eigenheit und steht auf keiner Verpackung. */
export function fuerSet(setNumber: string, name?: string | null): string {
  const nummer = String(setNumber ?? '').replace(/-\d+$/, '').trim();
  if (!nummer) return '';
  return suchUrl(['LEGO', nummer, String(name ?? '').trim()].filter(Boolean).join(' '));
}
