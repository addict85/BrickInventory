/**
 * Preisvergleich — die Adresse zum Nachsehen, was es anderswo kostet.
 * Ausführlich: docs/begruendungen/utils/preisvergleich.ts.md#basis
 */

/** Der Anbieter. Eine Zeile, absichtlich. */
const BASIS = 'https://www.toppreise.ch/produktsuche?q=';

/**
 * Die Suchadresse zu einem beliebigen Suchbegriff.
 *
 * Bewusst eine SUCHE und keine Produktseite: Eine Setnummer ist bei einem
 * Preisvergleicher kein Schluessel — dort heisst dasselbe Set „LEGO Star Wars
 * 75192 Millennium Falcon", und welche Schreibweise der Anbieter fuehrt,
 * weiss nur er. Eine Suche trifft in beiden Faellen.
 */
export function suchUrl(begriff: string): string {
  const q = String(begriff ?? '').trim();
  if (!q) return '';
  return BASIS + encodeURIComponent(q);
}

/**
 * Die Adresse zu einem Set.
 *
 * Nummer UND Name, wenn der Name da ist: „75192-1" allein findet bei einem
 * Preisvergleicher oft nichts, „LEGO 75192 Millennium Falcon" dagegen schon.
 * Die Variante („-1") faellt weg — sie ist eine Rebrickable-Eigenheit und
 * steht auf keiner Verpackung.
 */
export function fuerSet(setNumber: string, name?: string | null): string {
  const nummer = String(setNumber ?? '').replace(/-\d+$/, '').trim();
  if (!nummer) return '';
  return suchUrl(['LEGO', nummer, String(name ?? '').trim()].filter(Boolean).join(' '));
}
