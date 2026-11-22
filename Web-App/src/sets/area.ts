/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { SetsDependencies, SetsContext } from './context';
import { mit, buildArea, type Inspect } from '../infra/area';
import * as erfassen from './addSet';
import * as lesen from './read';
import * as loeschen from './delete';
import * as setMove from './setMove';
import * as dienst from './service';
import * as inhalt from './content';
import * as barcode from './barcode';
import * as preise from './prices';
import * as anleitungen from './instructions';
import * as csvImport from './csvImport';
import { setsJobTypes } from './jobTypes';
import * as setsRepo from './repository/sets';
import * as csvImportLauf from './csvImportLauf';

export function createSets(a: SetsDependencies, inspect?: Inspect<SetsContext>) {
  return buildArea(
    a,
    () => ({}),
    (sk: SetsContext) => ({
      setPresent: mit(sk)(erfassen.setPresent),
      setsOfAccount: mit(sk.db, setsRepo.setsOfAccount),
      setErfassen: mit(sk)(erfassen.setErfassen),
      setSupplement: mit(sk)(erfassen.setSupplement),
      changeSet: mit(sk)(dienst.changeSet),
      setsAlsCsv: mit(sk)(dienst.setsAlsCsv),
      setsLesen: mit(sk)(lesen.setsLesen),
      readSet: mit(sk)(lesen.readSet),
      withSetAggregate: mit(sk)(lesen.withSetAggregate),
      deleteSet: mit(sk)(loeschen.deleteSet),
      deleteSetFor: mit(sk)(loeschen.deleteSetFor),
      deleteSetRows: mit(sk)(loeschen.deleteSetRows),
      moveSet: mit(sk)(setMove.moveSet),
      setEntriesReassign: mit(sk)(setMove.setEntriesReassign),
      setInfo: mit(sk)(inhalt.setInfo),
      setInfoForAccount: mit(sk)(inhalt.setInfoForAccount),
      minifigsListOfSets: mit(sk)(inhalt.minifigsListOfSets),
      importPartsOfSets: mit(sk)(inhalt.importPartsOfSets),
      partListWithRework: mit(sk)(inhalt.partListWithRework),
      setToBarcode: mit(sk)(barcode.setToBarcode),
      setPrice: mit(sk)(preise.setPrice),
      readSetAlerts: mit(sk)(preise.readSetAlerts),
      setAlarmOfSets: mit(sk)(preise.setAlarmOfSets),
      deleteAlarmOfSets: mit(sk)(preise.deleteAlarmOfSets),
      startAlarmCsvImport: mit(sk)(preise.startAlarmCsvImport),
      setPriceHistory: mit(sk)(preise.setPriceHistory),
      rememberInstruction: mit(sk)(anleitungen.rememberInstruction),
      anleitungLoeschen: mit(sk)(anleitungen.anleitungLoeschen),
      loadInstructionsNew: mit(sk)(anleitungen.loadInstructionsNew),
      startSetCsvImport: mit(sk)(csvImport.startSetCsvImport),
      cancelSetCsvImport: mit(sk)(csvImport.cancelSetCsvImport),
      csvImportStand: mit(sk)(csvImport.csvImportStand),
      csvImportStatusForStream: mit(sk)(csvImport.csvImportStatusForStream),
      subscribeCsvImportStatus: mit(sk)(csvImport.subscribeCsvImportStatus),
      rebrickableList: mit(sk)(dienst.rebrickableList),
      setBelongsAccount: mit(sk)(dienst.setBelongsAccount),
      setLocationOfSets: mit(sk)(dienst.setLocationOfSets),
      locationsWithDefault: mit(sk)(dienst.locationsWithDefault),
      auftragsarten: () => setsJobTypes(sk),
      runCsvImportFrom: mit(sk)(csvImportLauf.runCsvImportFrom),
      csvImportGivenUp: mit(sk)(csvImportLauf.csvImportGivenUp),
    }),
    inspect,
  );
}

export type SetsServices = ReturnType<typeof createSets>;
