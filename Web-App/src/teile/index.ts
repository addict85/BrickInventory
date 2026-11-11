/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export { addManualPart, importiereTeileCsv } from './manuelleTeile';
export {
  getBlColorMap,
  getManualParts,
  getOwnedQuantities,
  getParts,
  getPartsCategories,
  getPartsColors,
  getPartsStats,
} from './abfragen';
export { getPartAcquisitions, getPartColorList, updateManualPart } from './manuelleTeile';
export { aendereTeilFarbe } from './teilFarbeAendern';
