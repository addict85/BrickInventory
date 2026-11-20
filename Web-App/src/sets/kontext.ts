import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import type { JobsServices } from '../auftraege';
import type { ForeignSourcesServices } from '../externalSources';
import type { ImagesServices } from '../images';
import type { InventoryServices } from '../inventory';
import type { FinancesServices } from '../finances';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { SettingsServices } from '../settings';
import type { AccountServices } from '../konto';
import type { Kontext } from '../infra/bereich';
import type { Uhr } from '../infra/uhr';

/** Was der Bereich von aussen bekommt, damit ein Test ihm einen eigenen Zugang geben kann; dass
 * alle Bereiche denselben nutzen, sichert buildServices (startup/verdrahtung.ts). */
export interface SetsDependencies {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  externalSources: ForeignSourcesServices;
  images: ImagesServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  household: HouseholdServices;
  auftraege: JobsServices;
  inventory: InventoryServices;
  einstellungen: SettingsServices;
  konto: AccountServices;
}
export type SetsContext = Kontext<SetsDependencies, object>;
