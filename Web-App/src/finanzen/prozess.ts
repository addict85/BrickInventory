import type { FinanzenDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Bereichs im Prozess, gebaut beim ersten Gebrauch (src/infra/bereich.ts).
 * Ohne Laufzeit-Import des Bereichs, damit Tests verdrahten können, bevor sie Module ersetzen. */
const stelle = prozessStelle<FinanzenDienste>('Finanzen');
export const verdrahteFinanzen = stelle.verdrahte;
export const finanzenBereich = stelle.hole;
