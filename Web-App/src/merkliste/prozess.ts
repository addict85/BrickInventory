import type { MerklisteDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const merklisteBereich = prozessStelle<MerklisteDienste>('merkliste');
