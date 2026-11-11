import type { EinstellungenDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Bereichs im Prozess, gebaut beim ersten Gebrauch (src/infra/bereich.ts).
 * Ohne Laufzeit-Import des Bereichs, damit Tests verdrahten können, bevor sie Module ersetzen. */
const stelle = prozessStelle<EinstellungenDienste>('Einstellungen');
export const verdrahteEinstellungen = stelle.verdrahte;
export const einstellungenBereich = stelle.hole;
