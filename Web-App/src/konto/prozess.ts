import type { KontoDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const kontoBereich = prozessStelle<KontoDienste>('konto');
