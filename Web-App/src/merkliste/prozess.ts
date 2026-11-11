import type { MerklisteDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Bereichs im Prozess, gebaut beim ersten Gebrauch (src/infra/bereich.ts).
 * Ohne Laufzeit-Import des Bereichs, damit Tests verdrahten können, bevor sie Module ersetzen. */
const stelle = prozessStelle<MerklisteDienste>('Merkliste');
export const verdrahteMerkliste = stelle.verdrahte;
export const merklisteBereich = stelle.hole;
