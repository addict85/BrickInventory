import type { SammlungDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Bereichs im Prozess, gebaut beim ersten Gebrauch (src/infra/bereich.ts).
 * Ohne Laufzeit-Import des Bereichs, damit Tests verdrahten können, bevor sie Module ersetzen. */
const stelle = prozessStelle<SammlungDienste>('Sammlung');
export const verdrahteSammlung = stelle.verdrahte;
export const sammlungBereich = stelle.hole;
