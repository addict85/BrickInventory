/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { SetsDependencies, SetsContext } from './context';
import { withValue, buildArea, type Inspect } from '../infra/area';
import * as acquire from './addSet';
import * as lesen from './read';
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
      setPresent: withValue(sk)(acquire.setPresent),
      setsOfAccount: withValue(sk.db, setsRepo.setsOfAccount),
      setErfassen: withValue(sk)(acquire.acquireSet),
      setSupplement: withValue(sk)(acquire.setSupplement),
      changeSet: withValue(sk)(service.changeSet),
      setsAlsCsv: withValue(sk)(service.setsAlsCsv),
      setsLesen: withValue(sk)(lesen.readSets),
      readSet: withValue(sk)(lesen.readSet),
      withSetAggregate: withValue(sk)(lesen.withSetAggregate),
      deleteSet: withValue(sk)(remove.deleteSet),
      deleteSetFor: withValue(sk)(remove.deleteSetFor),
      deleteSetRows: withValue(sk)(remove.deleteSetRows),
      moveSet: withValue(sk)(setMove.moveSet),
      setEntriesReassign: withValue(sk)(setMove.setEntriesReassign),
      setInfo: withValue(sk)(content.setInfo),
      setInfoForAccount: withValue(sk)(content.setInfoForAccount),
      minifigsListOfSets: withValue(sk)(content.minifigsListOfSets),
      importPartsOfSets: withValue(sk)(content.importPartsOfSets),
      partListWithRework: withValue(sk)(content.partListWithRework),
      setToBarcode: withValue(sk)(barcode.setToBarcode),
      setPrice: withValue(sk)(prices.setPrice),
      readSetAlerts: withValue(sk)(prices.readSetAlerts),
      setAlarmOfSets: withValue(sk)(prices.setAlarmOfSets),
      deleteAlarmOfSets: withValue(sk)(prices.deleteAlarmOfSets),
      startAlarmCsvImport: withValue(sk)(prices.startAlarmCsvImport),
      setPriceHistory: withValue(sk)(prices.setPriceHistory),
      rememberInstruction: withValue(sk)(anleitungen.rememberInstruction),
      anleitungLoeschen: withValue(sk)(anleitungen.deleteInstruction),
      loadInstructionsNew: withValue(sk)(anleitungen.loadInstructionsNew),
      startSetCsvImport: withValue(sk)(csvImport.startSetCsvImport),
      cancelSetCsvImport: withValue(sk)(csvImport.cancelSetCsvImport),
      csvImportStand: withValue(sk)(csvImport.csvImportStand),
      csvImportStatusForStream: withValue(sk)(csvImport.csvImportStatusForStream),
      subscribeCsvImportStatus: withValue(sk)(csvImport.subscribeCsvImportStatus),
      rebrickableList: withValue(sk)(service.rebrickableList),
      setBelongsAccount: withValue(sk)(service.setBelongsAccount),
      setLocationOfSets: withValue(sk)(service.setLocationOfSets),
      locationsWithDefault: withValue(sk)(service.locationsWithDefault),
      auftragsarten: () => setsJobTypes(sk),
      runCsvImportFrom: withValue(sk)(csvImportLauf.runCsvImportFrom),
      csvImportGivenUp: withValue(sk)(csvImportLauf.csvImportGivenUp),
    }),
    inspect,
  );
}

export type SetsServices = ReturnType<typeof createSets>;
