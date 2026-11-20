/** Was die Dienste bekommen; getrennt von area.ts, damit kein Importzyklus entsteht. */
import type { MailServices } from '../mail';
import type { VoucherServices } from '../vouchers';
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import * as management from './repository/management';
import type { SettingsServices } from '../settings';
import type { JobsServices } from '../auftraege';
import type { AccountServices } from '../account';
import type { FactorsServices } from '../factors';
import type { IdempotencyServices } from '../idempotency';
import type { CatalogServices } from '../catalog';
import type { ForeignSourcesServices } from '../externalSources';
import type { ImagesServices } from '../images';
import type { FinancesServices } from '../finances';
import type { InventoryServices } from '../inventory';
import type { SetsServices } from '../sets';
import type { WantedServices } from '../wanted';
import type { Uhr } from '../infra/uhr';

export interface ManagementDependencies {
  uhr: Uhr;
  db: Db;
  settings: SettingsServices;
  auftraege: JobsServices;
  account: AccountServices;
  factors: FactorsServices;
  idempotency: IdempotencyServices;
  catalog: CatalogServices;
  externalSources: ForeignSourcesServices;
  images: ImagesServices;
  finances: FinancesServices;
  inventory: InventoryServices;
  sets: SetsServices;
  wanted: WantedServices;
  vouchers: VoucherServices;
  mail: MailServices;
}

export const zugang = (db: Db) => ({
  // Diagnose und Zählungen gehen über alle Konten; die Routen selbst laufen ohne Systemrahmen.
  management: {
    holdingMinifigImagesOpen: imSystem(db, 'management', management.holdingMinifigImagesOpen),
    accountImageRows: imSystem(db, 'management', management.accountImageRows),
    bricklinkParts: imSystem(db, 'management', management.bricklinkParts),
    thumbnailImageMiss: imSystem(db, 'management', management.thumbnailImageMiss),
    setImageMiss: imSystem(db, 'management', management.setImageMiss),
    catalogImage: imSystem(db, 'management', management.catalogImage),
    catalogImageCandidates: imSystem(db, 'management', management.catalogImageCandidates),
    catalogImagesOpen: imSystem(db, 'management', management.catalogImagesOpen),
    lastRunOfType: imSystem(db, 'management', management.lastRunOfType),
    openImageJobs: imSystem(db, 'management', management.openImageJobs),
    samplePriceCache: imSystem(db, 'management', management.samplePriceCache),
    samplePriceHistory: imSystem(db, 'management', management.samplePriceHistory),
    logSince: imSystem(db, 'management', management.logSince),
    rbInventoryParts: imSystem(db, 'management', management.rbInventoryParts),
    rbParts: imSystem(db, 'management', management.rbParts),
    setImageMisses: imSystem(db, 'management', management.setImageMisses),
    setImageMissesWithout404: imSystem(db, 'management', management.setImageMissesWithout404),
    setMinifigImagesOpen: imSystem(db, 'management', management.setMinifigImagesOpen),
    setsWithoutInstructions: imSystem(db, 'management', management.setsWithoutInstructions),
    partImagesDone: imSystem(db, 'management', management.partImagesDone),
    partImagesOpen: imSystem(db, 'management', management.partImagesOpen),
    stalePrices: imSystem(db, 'management', management.stalePrices),
    pricesInCache: imSystem(db, 'management', management.pricesInCache),
    thumbnailImageMisses: imSystem(db, 'management', management.thumbnailImageMisses),
    mappedParts: imSystem(db, 'management', management.mappedParts),
    // Die Preisprobe sieht nur den eigenen Bestand des Verwalters: unter dem Zeilenschutz.
    sampleAcquisitions: mit(db)(management.sampleAcquisitions),
    sampleSet: mit(db)(management.sampleSet),
  },
});
export type ManagementContext = Kontext<ManagementDependencies, ReturnType<typeof zugang>>;
