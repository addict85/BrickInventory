import type { KatalogDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Der Katalog des Prozesses, gebaut beim ersten Gebrauch aus dem, was der Einstieg
 * (startup/verdrahtung.ts) übergibt. Ohne Verdrahtung ist ein Aufruf ein Fehler,
 * kein stiller Rückfall auf den Prozesszugang. Ohne Laufzeit-Import, damit Tests
 * verdrahten können, bevor sie Module ersetzen. */
const stelle = prozessStelle<KatalogDienste>('Katalog');
export const verdrahteKatalog = stelle.verdrahte;
export const katalog = stelle.hole;
