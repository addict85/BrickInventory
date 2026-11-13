/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { figurenBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export { erzeugeFiguren } from './bereich';
export type { FigurenDienste, FigurenKontext } from './bereich';
export { figurenBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  addManualFig,
  getFigAcquisitions,
  getManualMinifigs,
  getMinifigStats,
  getMinifigs,
  importiereFigurenCsv,
  teileDerFigur,
  updateManualFig,
} = dienstePerAufruf(figurenBereich, [
  'addManualFig',
  'getFigAcquisitions',
  'getManualMinifigs',
  'getMinifigStats',
  'getMinifigs',
  'importiereFigurenCsv',
  'teileDerFigur',
  'updateManualFig',
]);
