/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { dienstePerAufruf } from '../infra/bereich';
import { bestandBereich } from './prozess';

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
export { normalisiereLagerort, ortFuerNeuerfassung, vorgabeVon } from './lagerort';
export { mengenwunsch } from './manuelleMenge';
export { legeInPapierkorb, legeKaeufeInPapierkorb } from './papierkorb';
export { acquisitionTotals } from './acquisitions';
export { benenneOrtUm, lagerorte, legeOrtAn, loescheOrt } from './lagerort';
export { erzeugeBestand } from './bereich';
export type { BestandDienste, BestandKontext } from './bereich';
export { bestandBereich } from './prozess';

/** Für Routen: die Lagerort-Dienste des Prozesses ohne Zugang als ersten Parameter. */
export const lagerort = dienstePerAufruf(
  () => bestandBereich().lagerortDienst,
  ['benenneOrtUm', 'lagerorte', 'legeOrtAn', 'loescheOrt', 'setzeLagerort'],
);

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  applyManualCondition,
  buildFigsCsv,
  buildPartsCsv,
  erfassungenInKontowaehrung,
  findSameDayAcquisition,
  getStats,
  lagerSchreibkonto,
  leerePapierkorb,
  listePapierkorb,
  loescheEndgueltig,
  orteFuer,
  passeManuelleMengeAn,
  raeumePapierkorbAuf,
  recordAcquisitionForDay,
  run,
  setzeGeschaetztenPreis,
  setzeVorgabe,
  stelleWiederHer,
  verwendendeSets,
} = dienstePerAufruf(bestandBereich, [
  'applyManualCondition',
  'buildFigsCsv',
  'buildPartsCsv',
  'erfassungenInKontowaehrung',
  'findSameDayAcquisition',
  'getStats',
  'lagerSchreibkonto',
  'leerePapierkorb',
  'listePapierkorb',
  'loescheEndgueltig',
  'orteFuer',
  'passeManuelleMengeAn',
  'raeumePapierkorbAuf',
  'recordAcquisitionForDay',
  'run',
  'setzeGeschaetztenPreis',
  'setzeVorgabe',
  'stelleWiederHer',
  'verwendendeSets',
]);
