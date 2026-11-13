/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */

export {
  MAX_PAGE_SIZE,
  SET_PARTS_MAX_PAGE_SIZE,
  UNPAGED_LIMIT,
  clampPageSize,
  conditionFromAcquisitions,
  conditionsFromAcquisitions,
  entferneSetInhalt,
  kopiereSetInhalt,
  legeManuellAn,
  loescheManuelleFigur,
  loescheManuellesTeil,
} from './gemeinsam';
export { normalisiereLagerort, ortFuerNeuerfassung, setzeLagerort, vorgabeVon } from './lagerort';
export { mengenwunsch } from './manuelleMenge';
export { legeInPapierkorb, legeKaeufeInPapierkorb } from './papierkorb';
export { acquisitionTotals } from './acquisitions';
export { benenneOrtUm, lagerorte, legeOrtAn, loescheOrt } from './lagerort';
export { erzeugeBestand } from './bereich';
export type { BestandDienste, BestandKontext } from './bereich';
