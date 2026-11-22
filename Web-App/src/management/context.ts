/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { MailServices } from '../mail';
import type { VoucherServices } from '../vouchers';
import type { Db } from '../../db/database';
import { imSystem, bound, type Context } from '../infra/area';
import * as management from './repository/management';
import type { SettingsServices } from '../settings';
import type { JobsServices } from '../jobQueue';
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
import type { Clock } from '../infra/clock';

export interface ManagementDependencies {
  clock: Clock;
  db: Db;
  settings: SettingsServices;
  jobQueue: JobsServices;
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

export const access = (db: Db) => ({
  // Diagnostics and counts span all accounts; the routes themselves run without a system frame.
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
    // The price probe only sees the admin's own inventory: under row security.
    sampleAcquisitions: bound(db)(management.sampleAcquisitions),
    sampleSet: bound(db)(management.sampleSet),
  },
});
export type ManagementContext = Context<ManagementDependencies, ReturnType<typeof access>>;
