/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { sammlungBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export type { ErfassungsArt } from './erfassungen';
export { erzeugeSammlung } from './bereich';
export type { SammlungDienste, SammlungKontext } from './bereich';
export { sammlungBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  erfassungAendern,
  erfassungLoeschen,
  fuehreImportAus,
  loescheAllesEigene,
  loescheFigur,
  loescheTeil,
  setErfassungen,
} = dienstePerAufruf(sammlungBereich, [
  'erfassungAendern',
  'erfassungLoeschen',
  'fuehreImportAus',
  'loescheAllesEigene',
  'loescheFigur',
  'loescheTeil',
  'setErfassungen',
]);
