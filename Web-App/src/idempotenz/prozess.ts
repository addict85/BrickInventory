import type { IdempotenzDienste } from './bereich';
import { prozessStelle } from '../infra/bereich';

/** Die Dienste des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen Kontext. */
export const idempotenzBereich = prozessStelle<IdempotenzDienste>('idempotenz');
