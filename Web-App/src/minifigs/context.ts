/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as minifigsList from './repository/minifigsList';
import * as minifigParts from './repository/minifigParts';
import * as manualMinifigs from './repository/manualMinifigs';
import type { SettingsServices } from '../settings';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { AuftraegeDienste } from '../auftraege';
import type { FremdquellenDienste } from '../fremdquellen';
import type { Uhr } from '../infra/uhr';

export interface MinifigsDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  fremdquellen: FremdquellenDienste;
  auftraege: AuftraegeDienste;
}

export const access = (db: Db) => ({
  minifigsList: {
    groupedMinifigs: mit(db)(minifigsList.groupedMinifigs),
    manualMinifigsList: mit(db)(minifigsList.manualMinifigsList),
    conditionCountsOfManualMinifigs: mit(db)(minifigsList.conditionCountsOfManualMinifigs),
    minifigStats: mit(db)(minifigsList.minifigStats),
  },
  minifigParts: {
    catalogPartsOfMinifig: mit(db)(minifigParts.catalogPartsOfMinifig),
    inventoryPartsOfMinifig: mit(db)(minifigParts.inventoryPartsOfMinifig),
    setWithMinifig: mit(db)(minifigParts.setWithMinifig),
  },
  manualMinifigs: {
    manualMinifigRow: mit(db)(manualMinifigs.manualMinifigRow),
    minifigRowWithCondition: mit(db)(manualMinifigs.minifigRowWithCondition),
    minifigAcquisitions: mit(db)(manualMinifigs.minifigAcquisitions),
  },
});
export type MinifigsContext = Kontext<MinifigsDependencies, ReturnType<typeof access>>;
