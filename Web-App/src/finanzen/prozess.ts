import type { FinanzenDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const finanzenBereich = prozessStelle<FinanzenDienste>('finanzen');
