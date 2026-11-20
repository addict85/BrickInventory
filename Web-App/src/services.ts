/** The set of services from startup/wiring.ts, here so that routes/ and jobs/ do not depend on
 * startup/, which mounts them; router factories narrow it with Pick<>. */
import type { JobsServices } from './jobQueue';
import type { InventoryServices } from './inventory';
import type { ImagesServices } from './images';
import type { ThrottleServices } from './throttle';
import type { SettingsServices } from './settings';
import type { MinifigsServices } from './minifigs';
import type { DevicesServices } from './devices';
import type { FactorsServices } from './factors';
import type { FinancesServices } from './finances';
import type { ForeignSourcesServices } from './externalSources';
import type { VoucherServices } from './vouchers';
import type { HouseholdServices } from './household';
import type { IdempotencyServices } from './idempotency';
import type { CatalogServices } from './catalog';
import type { AccountServices } from './account';
import type { MailServices } from './mail';
import type { ProfileServices } from './profile';
import type { WantedServices } from './wanted';
import type { CollectionServices } from './collection';
import type { SetsServices } from './sets';
import type { PartsServices } from './parts';
import type { ManagementServices } from './management';
import * as bestandSicht from '../db/inventoryView';
import * as bestandsmenge from '../db/stockQuantity';
import * as haushaltSicht from '../db/householdView';
import * as kontoSicht from '../db/accountView';
import * as zugangSicht from '../db/accessView';

/** What lower areas read from tables of higher ones: each names in its read contract the shape
 * it needs and gets the SQL from here above the owner, not via import (docs/architektur.md). */
export const LESEVERTRAG = { ...bestandSicht, ...bestandsmenge, ...haushaltSicht, ...kontoSicht, ...zugangSicht };

export interface Dienste {
  throttle: ThrottleServices;
  settings: SettingsServices;
  mail: MailServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  devices: DevicesServices;
  factors: FactorsServices;
  account: AccountServices;
  profile: ProfileServices;
  idempotency: IdempotencyServices;
  externalSources: ForeignSourcesServices;
  images: ImagesServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  inventory: InventoryServices;
  sets: SetsServices;
  parts: PartsServices;
  minifigs: MinifigsServices;
  wanted: WantedServices;
  vouchers: VoucherServices;
  collection: CollectionServices;
  management: ManagementServices;
}
