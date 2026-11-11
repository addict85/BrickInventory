/** Der Einstieg in den Bereich Sets: Routen und andere Bereiche importieren nur
 * von hier, damit die Aufteilung der Dateien darunter frei bleibt. Was Datenbank
 * oder Nacharbeit braucht, entsteht in bereich.ts; die Namen hier reichen an die
 * Dienste des Prozesses weiter (prozess.ts). */
import type { SetsDienste } from './bereich';
import { sets } from './prozess';

export { erzeugeSets } from './bereich';
export type { SetsDienste } from './bereich';
export type { SetsKontext } from './kontext';
export { sets, verdrahteSets } from './prozess';
export { normalizeSetNumber, nacharbeitEinstellen } from './erfassen';
export { sanitizeSetNumber } from './setService';
export { deleteSetRows } from './loeschen';
export { moveSetBetweenAccounts, moveManualAcquisition } from './setMove';
export { QUELLE_GESTOERT } from './inhalt';
export {
  setCsvZeilen,
  setCsvImportAbbrechen,
  csvImportStand,
  csvImportStandFuerStrom,
  csvImportStandAbonnieren,
} from './csvImport';
export { ANLEITUNGS_WURZEL } from './anleitungen';
export { ladeSetBilder } from './nachErfassung';
export { csvImportAufgegeben } from './csvImportLauf';
export type { Erfassung, NeuesSet, SetErfasst, SetHinzufuegen, VorhandenesSet, Fortschritt } from './erfassen';
export type { MoveResult } from './setMove';
export type { BarcodeTreffer } from './barcode';
export type { ImportZeile } from './csvImport';
export type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';

const dienst = <K extends keyof SetsDienste>(name: K): SetsDienste[K] =>
  ((...a: unknown[]) => (sets()[name] as (...x: unknown[]) => unknown)(...a)) as SetsDienste[K];

export const recordAcquisition = dienst('recordAcquisition');
export const findSetInScope = dienst('findSetInScope');
export const setErfassen = dienst('setErfassen');
export const setErgaenzen = dienst('setErgaenzen');
export const addSet = dienst('addSet');
export const addSetWithDate = dienst('addSetWithDate');
export const updateSet = dienst('updateSet');
export const buildSetsCsv = dienst('buildSetsCsv');
export const getSets = dienst('getSets');
export const getSet = dienst('getSet');
export const getSetConditionAggregate = dienst('getSetConditionAggregate');
export const withSetAggregate = dienst('withSetAggregate');
export const loescheSet = dienst('loescheSet');
export const loescheSetFuer = dienst('loescheSetFuer');
export const verschiebeSet = dienst('verschiebeSet');
export const setInfo = dienst('setInfo');
export const setInfoFuerKonto = dienst('setInfoFuerKonto');
export const setZumBarcode = dienst('setZumBarcode');
export const teilelisteDesSets = dienst('teilelisteDesSets');
export const figurenlisteDesSets = dienst('figurenlisteDesSets');
export const setPreis = dienst('setPreis');
export const rebrickableListe = dienst('rebrickableListe');
export const setGehoertKonto = dienst('setGehoertKonto');
export const anleitungMerken = dienst('anleitungMerken');
export const anleitungLoeschen = dienst('anleitungLoeschen');
export const setCsvImportStarten = dienst('setCsvImportStarten');
export const teileDesSetsImportieren = dienst('teileDesSetsImportieren');
export const anleitungenNeuLaden = dienst('anleitungenNeuLaden');
export const teilelisteMitNacharbeit = dienst('teilelisteMitNacharbeit');
export const setVerschieben = dienst('setVerschieben');
export const zieheNach = dienst('zieheNach');
export const fuehreCsvImportAus = dienst('fuehreCsvImportAus');
export const waehrungVon = dienst('waehrungVon');
export const lagerortDesSetsSetzen = dienst('lagerortDesSetsSetzen');
export const lagerorteMitVorgabe = dienst('lagerorteMitVorgabe');
export const setAlarmeLesen = dienst('setAlarmeLesen');
export const alarmDesSetsSetzen = dienst('alarmDesSetsSetzen');
export const alarmDesSetsLoeschen = dienst('alarmDesSetsLoeschen');
export const alarmCsvImportStarten = dienst('alarmCsvImportStarten');
export const setPreisVerlauf = dienst('setPreisVerlauf');
