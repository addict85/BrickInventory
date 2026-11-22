/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { SetsDependencies, SetsContext } from './context';
import { bound, buildArea, type Inspect } from '../infra/area';
import * as acquire from './addSet';
import * as read from './read';
import * as remove from './delete';
import * as setMove from './setMove';
import * as service from './service';
import * as content from './content';
import * as barcode from './barcode';
import * as prices from './prices';
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
      setPresent: bound(sk)(acquire.setPresent),
      setsOfAccount: bound(sk.db, setsRepo.setsOfAccount),
      acquireSet: bound(sk)(acquire.acquireSet),
      setSupplement: bound(sk)(acquire.setSupplement),
      changeSet: bound(sk)(service.changeSet),
      setsAlsCsv: bound(sk)(service.setsAlsCsv),
      readSets: bound(sk)(read.readSets),
      readSet: bound(sk)(read.readSet),
      withSetAggregate: bound(sk)(read.withSetAggregate),
      deleteSet: bound(sk)(remove.deleteSet),
      deleteSetFor: bound(sk)(remove.deleteSetFor),
      deleteSetRows: bound(sk)(remove.deleteSetRows),
      moveSet: bound(sk)(setMove.moveSet),
      setEntriesReassign: bound(sk)(setMove.setEntriesReassign),
      setInfo: bound(sk)(content.setInfo),
      setInfoForAccount: bound(sk)(content.setInfoForAccount),
      minifigsListOfSets: bound(sk)(content.minifigsListOfSets),
      importPartsOfSets: bound(sk)(content.importPartsOfSets),
      partListWithRework: bound(sk)(content.partListWithRework),
      setToBarcode: bound(sk)(barcode.setToBarcode),
      setPrice: bound(sk)(prices.setPrice),
      readSetAlerts: bound(sk)(prices.readSetAlerts),
      setAlarmOfSets: bound(sk)(prices.setAlarmOfSets),
      deleteAlarmOfSets: bound(sk)(prices.deleteAlarmOfSets),
      startAlarmCsvImport: bound(sk)(prices.startAlarmCsvImport),
      setPriceHistory: bound(sk)(prices.setPriceHistory),
      rememberInstruction: bound(sk)(anleitungen.rememberInstruction),
      deleteInstruction: bound(sk)(anleitungen.deleteInstruction),
      loadInstructionsNew: bound(sk)(anleitungen.loadInstructionsNew),
      startSetCsvImport: bound(sk)(csvImport.startSetCsvImport),
      cancelSetCsvImport: bound(sk)(csvImport.cancelSetCsvImport),
      csvImportStand: bound(sk)(csvImport.csvImportStand),
      csvImportStatusForStream: bound(sk)(csvImport.csvImportStatusForStream),
      subscribeCsvImportStatus: bound(sk)(csvImport.subscribeCsvImportStatus),
      rebrickableList: bound(sk)(service.rebrickableList),
      setBelongsAccount: bound(sk)(service.setBelongsAccount),
      setLocationOfSets: bound(sk)(service.setLocationOfSets),
      locationsWithDefault: bound(sk)(service.locationsWithDefault),
      jobKinds: () => setsJobTypes(sk),
      runCsvImportFrom: bound(sk)(csvImportLauf.runCsvImportFrom),
      csvImportGivenUp: bound(sk)(csvImportLauf.csvImportGivenUp),
    }),
    inspect,
  );
}

export type SetsServices = ReturnType<typeof createSets>;
