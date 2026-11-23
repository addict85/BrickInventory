/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { MailServices } from '../mail';
import type { VoucherServices } from '../vouchers';
import type { Db } from '../../db/database';
import { asSystem, bound, type Context } from '../infra/area';
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
    holdingMinifigImagesOpen: asSystem(db, 'management', management.holdingMinifigImagesOpen),
    accountImageRows: asSystem(db, 'management', management.accountImageRows),
    bricklinkParts: asSystem(db, 'management', management.bricklinkParts),
    thumbnailImageMiss: asSystem(db, 'management', management.thumbnailImageMiss),
    setImageMiss: asSystem(db, 'management', management.setImageMiss),
    catalogImage: asSystem(db, 'management', management.catalogImage),
    catalogImageCandidates: asSystem(db, 'management', management.catalogImageCandidates),
    catalogImagesOpen: asSystem(db, 'management', management.catalogImagesOpen),
    lastRunOfType: asSystem(db, 'management', management.lastRunOfType),
    openImageJobs: asSystem(db, 'management', management.openImageJobs),
    samplePriceCache: asSystem(db, 'management', management.samplePriceCache),
    samplePriceHistory: asSystem(db, 'management', management.samplePriceHistory),
    logSince: asSystem(db, 'management', management.logSince),
    rbInventoryParts: asSystem(db, 'management', management.rbInventoryParts),
    rbParts: asSystem(db, 'management', management.rbParts),
    setImageMisses: asSystem(db, 'management', management.setImageMisses),
    setImageMissesWithout404: asSystem(db, 'management', management.setImageMissesWithout404),
    setMinifigImagesOpen: asSystem(db, 'management', management.setMinifigImagesOpen),
    setsWithoutInstructions: asSystem(db, 'management', management.setsWithoutInstructions),
    partImagesDone: asSystem(db, 'management', management.partImagesDone),
    partImagesOpen: asSystem(db, 'management', management.partImagesOpen),
    stalePrices: asSystem(db, 'management', management.stalePrices),
    pricesInCache: asSystem(db, 'management', management.pricesInCache),
    thumbnailImageMisses: asSystem(db, 'management', management.thumbnailImageMisses),
    mappedParts: asSystem(db, 'management', management.mappedParts),
    // The price probe only sees the admin's own inventory: under row security.
    sampleAcquisitions: bound(db)(management.sampleAcquisitions),
    sampleSet: bound(db)(management.sampleSet),
  },
});
export type ManagementContext = Context<ManagementDependencies, ReturnType<typeof access>>;
