/** Der Einstieg in den Bereich Sets: Routen und andere Bereiche importieren nur
 * von hier, damit die Aufteilung der Dateien darunter frei bleibt. */
export {
  setErfassen,
  setErgaenzen,
  addSet,
  addSetWithDate,
  findSetInScope,
  normalizeSetNumber,
  recordAcquisition,
  nacharbeitEinstellen,
} from './erfassen';
export type { Erfassung, NeuesSet, SetErfasst, SetHinzufuegen, VorhandenesSet, Fortschritt } from './erfassen';
export { updateSet, buildSetsCsv, sanitizeSetNumber } from './setService';
export { getSet, getSets, withSetAggregate, getSetConditionAggregate } from './lesen';
export { loescheSetFuer, deleteSet, deleteSetRows } from './loeschen';
export { verschiebeSet, moveSetBetweenAccounts, moveManualAcquisition } from './setMove';
export type { MoveResult } from './setMove';
export * from './dienst';
export { zieheNach, ladeSetBilder } from './nachErfassung';
export { fuehreCsvImportAus, csvImportAufgegeben } from './csvImportLauf';
