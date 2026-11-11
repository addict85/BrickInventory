/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export { addManualFig, importiereFigurenCsv } from './manuelleFiguren';
export { getManualMinifigs, getMinifigStats, getMinifigs } from './abfragen';
export { teileDerFigur } from './dienst';
export { getFigAcquisitions, updateManualFig } from './manuelleFiguren';
export { erzeugeFiguren } from './bereich';
export type { FigurenDienste, FigurenKontext } from './bereich';
export { figurenBereich, verdrahteFiguren } from './prozess';
