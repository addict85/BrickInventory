import type { VerwaltungDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const verwaltungBereich = prozessStelle<VerwaltungDienste>('verwaltung');
