import type { SetsDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses, gebaut beim ersten Gebrauch aus dem, was der Einstieg
 * (startup/verdrahtung.ts) übergibt. Ohne Verdrahtung ist ein Aufruf ein Fehler:
 * Ein stiller Rückfall auf den Datenbankzugang des Prozesses verdeckte, wer fehlt.
 * Ohne Laufzeit-Import, damit Tests verdrahten können, bevor sie Module ersetzen. */
const stelle = prozessStelle<SetsDienste>('Sets');
export const verdrahteSets = stelle.verdrahte;
export const sets = stelle.hole;
