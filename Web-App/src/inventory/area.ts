/** Die Fabrik des Bereichs: Dienste als Closure über k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/area';
import * as acquisitions from './acquisitions';
import * as inventoryExportService from './inventoryExport';
import * as sharedService from './shared';
import * as inhalt from './content';
import * as metricsService from './metrics';
import * as manuelleMenge from './manualQuantity';
import * as trashService from './trash';
import * as kaufpreisNachtrag from './purchasePriceBackfill';
import * as lagerortRechte from './storageLocationRights';
import * as locationService from './storageLocation';
import * as lagerortSetzen from './setStorageLocation';
import { schreibwege } from './writePaths';
import { zugang, type InventoryDependencies, type InventoryContext } from './context';

export type { InventoryDependencies, InventoryContext } from './context';

export function createInventory(a: InventoryDependencies, inspect?: Inspect<InventoryContext>) {
  return buildArea(
    a,
    (db: Db) => zugang(db, a.lesevertrag),
    (k: InventoryContext) => ({
      bookDailyEntry: mit(k)(acquisitions.addPurchaseAtTag),
      entryAtSameTag: mit(k)(acquisitions.purchaseAtSameTag),
      setEstimatedPrice: mit(k)(acquisitions.setEstimatedPrice),
      erfassungenInKontowaehrung: mit(k)(acquisitions.erfassungenInKontowaehrung),
      partsAsCsv: mit(k)(inventoryExportService.partsCsv),
      minifigsAsCsv: mit(k)(inventoryExportService.figurenCsv),
      usingSets: mit(k)(sharedService.usingSets),
      deleteManual: mit(k)(sharedService.deleteManual),
      setInhalt: {
        enterParts: mit(k)(inhalt.enterParts),
        enterMinifigs: mit(k)(inhalt.enterMinifigs),
        entfernen: mit(k)(inhalt.entfernen),
        kopieren: mit(k)(inhalt.kopieren),
      },
      manuell: {
        putRowAn: mit(k)(inhalt.putRowAn),
        partsOfAccount: mit(k)(inhalt.partsOfAccount),
        minifigsOfAccount: mit(k)(inhalt.minifigsOfAccount),
        recolorPartRow: mit(k)(inhalt.recolorPartRow),
      },
      setzeManuellenZustand: mit(k)(sharedService.manuellenZustandSetzen),
      inventoryMetrics: mit(k)(metricsService.getStats),
      passeManualQuantityAn: mit(k)(manuelleMenge.passeManualQuantityAn),
      putInTrash: mit(k)(trashService.putInTrash),
      putPurchasesInTrash: mit(k)(trashService.putPurchasesInTrash),
      listTrash: mit(k)(trashService.listTrash),
      placeAgainHer: mit(k)(trashService.placeAgainHer),
      deleteFinal: mit(k)(trashService.deleteFinal),
      emptyTrash: mit(k)(trashService.emptyTrash),
      cleanTrashOn: mit(k)(trashService.cleanTrashOn),
      backfillPurchasePrices: mit(k)(kaufpreisNachtrag.run),
      locationService: {
        benenneOrtUm: mit(k)(locationService.benenneOrtUm),
        lagerorte: mit(k)(locationService.lagerorte),
        putLocationAn: mit(k)(locationService.putLocationAn),
        loescheOrt: mit(k)(locationService.loescheOrt),
        locationForNewEntry: mit(k)(locationService.locationForNewEntry),
        vorgabeVon: mit(k)(locationService.vorgabeVon),
        setLocation: mit(k)(lagerortSetzen.setLocation),
      },

      ...schreibwege(k),

      setDefault: mit(k)(lagerortRechte.setDefault),
      lagerSchreibkonto: mit(k)(lagerortRechte.lagerSchreibkonto),
      locationsFor: mit(k)(lagerortRechte.locationsFor),
    }),
    inspect,
  );
}

export type InventoryServices = ReturnType<typeof createInventory>;
