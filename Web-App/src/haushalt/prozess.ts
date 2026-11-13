import type { HaushaltDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const haushaltBereich = prozessStelle<HaushaltDienste>('haushalt');
