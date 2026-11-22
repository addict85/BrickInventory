/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
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
      bookDailyEntry: bound(k)(acquisitions.addPurchaseAtTag),
      entryAtSameTag: bound(k)(acquisitions.purchaseAtSameTag),
      setEstimatedPrice: bound(k)(acquisitions.setEstimatedPrice),
      acquisitionsInAccountCurrency: bound(k)(acquisitions.acquisitionsInAccountCurrency),
      partsAsCsv: bound(k)(inventoryExportService.partsCsv),
      minifigsAsCsv: bound(k)(inventoryExportService.minifigsCsv),
      usingSets: bound(k)(sharedService.usingSets),
      deleteManual: bound(k)(sharedService.deleteManual),
      setInhalt: {
        enterParts: bound(k)(content.enterParts),
        enterMinifigs: bound(k)(content.enterMinifigs),
        remove: bound(k)(content.removeContent),
        copy: bound(k)(content.copy),
      },
      manuell: {
        createRow: bound(k)(content.createRow),
        partsOfAccount: bound(k)(content.partsOfAccount),
        minifigsOfAccount: bound(k)(content.minifigsOfAccount),
        recolorPartRow: bound(k)(content.recolorPartRow),
      },
      setManualCondition: bound(k)(sharedService.setManualCondition),
      inventoryMetrics: bound(k)(metricsService.getStats),
      adjustManualQuantity: bound(k)(manualQuantity.adjustManualQuantity),
      putInTrash: bound(k)(trashService.putInTrash),
      putPurchasesInTrash: bound(k)(trashService.putPurchasesInTrash),
      listTrash: bound(k)(trashService.listTrash),
      restore: bound(k)(trashService.restore),
      deleteFinal: bound(k)(trashService.deleteFinal),
      emptyTrash: bound(k)(trashService.emptyTrash),
      cleanTrashOn: bound(k)(trashService.cleanTrashOn),
      backfillPurchasePrices: bound(k)(purchasePriceBackfill.run),
      locationService: {
        renameStorage: bound(k)(locationService.renameStorage),
        storages: bound(k)(locationService.lagerorte),
        createStorage: bound(k)(locationService.createStorage),
        deleteStorage: bound(k)(locationService.deleteStorage),
        locationForNewEntry: bound(k)(locationService.locationForNewEntry),
        defaultOf: bound(k)(locationService.defaultOf),
        setLocation: bound(k)(setStorage.setLocation),
      },

      ...writePaths(k),

      setDefault: bound(k)(storageRights.setDefault),
      storageWriteAccount: bound(k)(storageRights.storageWriteAccount),
      locationsFor: bound(k)(storageRights.locationsFor),
    }),
    inspect,
  );
}

export type InventoryServices = ReturnType<typeof createInventory>;
