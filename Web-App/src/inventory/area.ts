/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import * as acquisitions from './acquisitions';
import * as inventoryExportService from './inventoryExport';
import * as sharedService from './shared';
import * as content from './content';
import * as metricsService from './metrics';
import * as manualQuantity from './manualQuantity';
import * as trashService from './trash';
import * as purchasePriceBackfill from './purchasePriceBackfill';
import * as storageRights from './storageLocationRights';
import * as locationService from './storageLocation';
import * as setStorage from './setStorageLocation';
import { writePaths } from './writePaths';
import { access, type InventoryDependencies, type InventoryContext } from './context';

export type { InventoryDependencies, InventoryContext } from './context';

export function createInventory(a: InventoryDependencies, inspect?: Inspect<InventoryContext>) {
  return buildArea(
    a,
    (db: Db) => access(db, a.lesevertrag),
    (k: InventoryContext) => ({
      bookDailyEntry: withValue(k)(acquisitions.addPurchaseAtTag),
      entryAtSameTag: withValue(k)(acquisitions.purchaseAtSameTag),
      setEstimatedPrice: withValue(k)(acquisitions.setEstimatedPrice),
      erfassungenInKontowaehrung: withValue(k)(acquisitions.acquisitionsInAccountCurrency),
      partsAsCsv: withValue(k)(inventoryExportService.partsCsv),
      minifigsAsCsv: withValue(k)(inventoryExportService.figurenCsv),
      usingSets: withValue(k)(sharedService.usingSets),
      deleteManual: withValue(k)(sharedService.deleteManual),
      setInhalt: {
        enterParts: withValue(k)(content.enterParts),
        enterMinifigs: withValue(k)(content.enterMinifigs),
        entfernen: withValue(k)(content.remove),
        kopieren: withValue(k)(content.copy),
      },
      manuell: {
        putRowAn: withValue(k)(content.createRow),
        partsOfAccount: withValue(k)(content.partsOfAccount),
        minifigsOfAccount: withValue(k)(content.minifigsOfAccount),
        recolorPartRow: withValue(k)(content.recolorPartRow),
      },
      setzeManuellenZustand: withValue(k)(sharedService.setManualCondition),
      inventoryMetrics: withValue(k)(metricsService.getStats),
      passeManualQuantityAn: withValue(k)(manualQuantity.adjustManualQuantity),
      putInTrash: withValue(k)(trashService.putInTrash),
      putPurchasesInTrash: withValue(k)(trashService.putPurchasesInTrash),
      listTrash: withValue(k)(trashService.listTrash),
      placeAgainHer: withValue(k)(trashService.placeAgainHer),
      deleteFinal: withValue(k)(trashService.deleteFinal),
      emptyTrash: withValue(k)(trashService.emptyTrash),
      cleanTrashOn: withValue(k)(trashService.cleanTrashOn),
      backfillPurchasePrices: withValue(k)(purchasePriceBackfill.run),
      locationService: {
        benenneOrtUm: withValue(k)(locationService.renameStorage),
        lagerorte: withValue(k)(locationService.lagerorte),
        putLocationAn: withValue(k)(locationService.createStorage),
        loescheOrt: withValue(k)(locationService.deleteStorage),
        locationForNewEntry: withValue(k)(locationService.locationForNewEntry),
        vorgabeVon: withValue(k)(locationService.defaultOf),
        setLocation: withValue(k)(setStorage.setLocation),
      },

      ...writePaths(k),

      setDefault: withValue(k)(storageRights.setDefault),
      lagerSchreibkonto: withValue(k)(storageRights.storageWriteAccount),
      locationsFor: withValue(k)(storageRights.locationsFor),
    }),
    inspect,
  );
}

export type InventoryServices = ReturnType<typeof createInventory>;
