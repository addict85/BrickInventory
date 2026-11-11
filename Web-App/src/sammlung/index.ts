/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export { erfassungAendern, erfassungLoeschen, setErfassungen } from './erfassungen';
export type { ErfassungsArt } from './erfassungen';
export { fuehreImportAus } from './importAuftraege';
export { loescheAllesEigene, loescheFigur, loescheTeil } from './loeschen';
export { erzeugeSammlung } from './bereich';
export type { SammlungDienste, SammlungKontext } from './bereich';
export { sammlungBereich, verdrahteSammlung } from './prozess';
