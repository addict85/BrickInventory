import type { KatalogKontext } from './kontext';
import { prozessStelle } from '../infra/bereich';

/** Der Kontext des Prozesses (startup/verdrahtung.ts) für Wege ohne eigenen: HTTP-Seiten
 * und den Puffer der Nacharbeit. Nur der Kontext, damit kein Dienst über bereich.ts im Kreis lädt. */
export const katalog = prozessStelle<KatalogKontext>('katalog');
