/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
export { findSameDayAcquisition, recordAcquisitionForDay, setzeGeschaetztenPreis } from './acquisitions';
export { buildFigsCsv, buildPartsCsv } from './bestandExport';
export {
  MAX_PAGE_SIZE,
  SET_PARTS_MAX_PAGE_SIZE,
  UNPAGED_LIMIT,
  applyManualCondition,
  clampPageSize,
  conditionFromAcquisitions,
  conditionsFromAcquisitions,
  entferneSetInhalt,
  kopiereSetInhalt,
  legeManuellAn,
  loescheManuelleFigur,
  loescheManuellesTeil,
} from './gemeinsam';
export { run } from './kaufpreisNachtrag';
export { normalisiereLagerort, ortFuerNeuerfassung, orteFuer, setzeLagerort, vorgabeVon } from './lagerort';
export { mengenwunsch, passeManuelleMengeAn } from './manuelleMenge';
export { legeInPapierkorb, legeKaeufeInPapierkorb, raeumePapierkorbAuf } from './papierkorb';
export { acquisitionTotals, erfassungenInKontowaehrung } from './acquisitions';
export { verwendendeSets } from './gemeinsam';
export { getStats } from './kennzahlen';
export { benenneOrtUm, lagerSchreibkonto, lagerorte, legeOrtAn, loescheOrt, setzeVorgabe } from './lagerort';
export { leerePapierkorb, listePapierkorb, loescheEndgueltig, stelleWiederHer } from './papierkorb';
export { erzeugeBestand } from './bereich';
export type { BestandDienste, BestandKontext } from './bereich';
export { bestandBereich, verdrahteBestand } from './prozess';
