/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { teileBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export { getPartColorList } from './manuelleTeile';
export { erzeugeTeile } from './bereich';
export type { TeileDienste, TeileKontext } from './bereich';
export { teileBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  addManualPart,
  aendereTeilFarbe,
  getBlColorMap,
  getManualParts,
  getOwnedQuantities,
  getPartAcquisitions,
  getParts,
  getPartsCategories,
  getPartsColors,
  getPartsStats,
  importiereTeileCsv,
  updateManualPart,
} = dienstePerAufruf(teileBereich, [
  'addManualPart',
  'aendereTeilFarbe',
  'getBlColorMap',
  'getManualParts',
  'getOwnedQuantities',
  'getPartAcquisitions',
  'getParts',
  'getPartsCategories',
  'getPartsColors',
  'getPartsStats',
  'importiereTeileCsv',
  'updateManualPart',
]);
