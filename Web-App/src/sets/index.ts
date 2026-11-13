/** Der Einstieg in den Bereich Sets: Routen und andere Bereiche importieren nur
 * von hier, damit die Aufteilung der Dateien darunter frei bleibt. Was Datenbank
 * oder Nacharbeit braucht, entsteht in bereich.ts; die Namen hier reichen an die
 * Dienste des Prozesses weiter (prozess.ts). */
import { dienstePerAufruf } from '../infra/bereich';
import { sets } from './prozess';

export { erzeugeSets } from './bereich';
export type { SetsDienste } from './bereich';
export type { SetsKontext } from './kontext';
export { sets } from './prozess';
export { normalizeSetNumber, nacharbeitEinstellen } from './erfassen';
export { sanitizeSetNumber } from './setService';
export { deleteSetRows } from './loeschen';
export { QUELLE_GESTOERT } from './inhalt';
export { setCsvZeilen } from './csvImport';
export { ANLEITUNGS_WURZEL } from './anleitungen';
export type { Erfassung, NeuesSet, SetErfasst, SetHinzufuegen, VorhandenesSet, Fortschritt } from './erfassen';
export type { MoveResult } from './setMove';
export type { BarcodeTreffer } from './barcode';
export type { ImportZeile } from './csvImport';
export type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  addSet,
  addSetWithDate,
  alarmCsvImportStarten,
  alarmDesSetsLoeschen,
  alarmDesSetsSetzen,
  anleitungLoeschen,
  anleitungMerken,
  anleitungenNeuLaden,
  buildSetsCsv,
  csvImportAufgegeben,
  csvImportStand,
  csvImportStandAbonnieren,
  csvImportStandFuerStrom,
  figurenlisteDesSets,
  findSetInScope,
  fuehreCsvImportAus,
  getSet,
  getSetConditionAggregate,
  getSets,
  ladeSetBilder,
  lagerortDesSetsSetzen,
  lagerorteMitVorgabe,
  loescheSet,
  loescheSetFuer,
  moveManualAcquisition,
  moveSetBetweenAccounts,
  rebrickableListe,
  recordAcquisition,
  setAlarmeLesen,
  setCsvImportAbbrechen,
  setCsvImportStarten,
  setErfassen,
  setErgaenzen,
  setGehoertKonto,
  setInfo,
  setInfoFuerKonto,
  setPreis,
  setPreisVerlauf,
  setVerschieben,
  setZumBarcode,
  teileDesSetsImportieren,
  teilelisteDesSets,
  teilelisteMitNacharbeit,
  updateSet,
  verschiebeSet,
  waehrungVon,
  withSetAggregate,
  zieheNach,
} = dienstePerAufruf(sets, [
  'addSet',
  'addSetWithDate',
  'alarmCsvImportStarten',
  'alarmDesSetsLoeschen',
  'alarmDesSetsSetzen',
  'anleitungLoeschen',
  'anleitungMerken',
  'anleitungenNeuLaden',
  'buildSetsCsv',
  'csvImportAufgegeben',
  'csvImportStand',
  'csvImportStandAbonnieren',
  'csvImportStandFuerStrom',
  'figurenlisteDesSets',
  'findSetInScope',
  'fuehreCsvImportAus',
  'getSet',
  'getSetConditionAggregate',
  'getSets',
  'ladeSetBilder',
  'lagerortDesSetsSetzen',
  'lagerorteMitVorgabe',
  'loescheSet',
  'loescheSetFuer',
  'moveManualAcquisition',
  'moveSetBetweenAccounts',
  'rebrickableListe',
  'recordAcquisition',
  'setAlarmeLesen',
  'setCsvImportAbbrechen',
  'setCsvImportStarten',
  'setErfassen',
  'setErgaenzen',
  'setGehoertKonto',
  'setInfo',
  'setInfoFuerKonto',
  'setPreis',
  'setPreisVerlauf',
  'setVerschieben',
  'setZumBarcode',
  'teileDesSetsImportieren',
  'teilelisteDesSets',
  'teilelisteMitNacharbeit',
  'updateSet',
  'verschiebeSet',
  'waehrungVon',
  'withSetAggregate',
  'zieheNach',
]);
