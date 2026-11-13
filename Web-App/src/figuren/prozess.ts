import type { FigurenDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const figurenBereich = prozessStelle<FigurenDienste>('figuren');
