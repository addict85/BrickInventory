import type { Konfig } from '../infra/config';
import type { Db } from '../../db/database';
import type { JobsServices } from '../jobQueue';
import type { ForeignSourcesServices } from '../externalSources';
import type { ImagesServices } from '../images';
import type { InventoryServices } from '../inventory';
import type { FinancesServices } from '../finances';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { SettingsServices } from '../settings';
import type { AccountServices } from '../account';
import type { Kontext } from '../infra/area';
import type { Uhr } from '../infra/clock';

/** What the area gets from outside, so that a test can give it its own access; that
 * all areas use the same one is ensured by buildServices (startup/wiring.ts). */
export interface SetsDependencies {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  externalSources: ForeignSourcesServices;
  images: ImagesServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  household: HouseholdServices;
  jobQueue: JobsServices;
  inventory: InventoryServices;
  einstellungen: SettingsServices;
  account: AccountServices;
}
export type SetsContext = Kontext<SetsDependencies, object>;
