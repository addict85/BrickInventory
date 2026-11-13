/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { idempotenzBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export { erzeugeIdempotenz } from './bereich';
export type { IdempotenzDienste, IdempotenzKontext } from './bereich';
export { idempotenzBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  alleVergessen,
  alteAbdrueckeLoeschen,
  antwortenUmschluesseln,
  beende,
  beginne,
  gibFrei,
  mitWirkungsVermerk,
  raeumeIdempotenzAuf,
} = dienstePerAufruf(idempotenzBereich, [
  'alleVergessen',
  'alteAbdrueckeLoeschen',
  'antwortenUmschluesseln',
  'beende',
  'beginne',
  'gibFrei',
  'mitWirkungsVermerk',
  'raeumeIdempotenzAuf',
]);
