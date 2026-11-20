/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as wanted from './repository/wanted';
import * as wantedListe from './repository/wantedListe';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { FinancesServices } from '../finances';
import type { SetsServices } from '../sets';
import type { ForeignSourcesServices } from '../externalSources';
import type { ImagesServices } from '../images';
import type { Uhr } from '../infra/uhr';

export interface WantedDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  household: HouseholdServices;
  catalog: CatalogServices;
  finances: FinancesServices;
  externalSources: ForeignSourcesServices;
  images: ImagesServices;
  sets: SetsServices;
}

export const access = (db: Db) => ({
  wanted: {
    markSetWanted: mit(db)(wanted.markSetWanted),
    removeWantedEntry: mit(db)(wanted.removeWantedEntry),
    isWanted: mit(db)(wanted.isWanted),
    transferWantedEntry: mit(db)(wanted.transferWantedEntry),
    wantedListInScope: mit(db)(wanted.wantedListInScope),
    wantedListForExport: mit(db)(wanted.wantedListForExport),
  },
  // Cross-reference lookups for the BrickLink wanted-list XML import (BL→RB
  // number mapping); left under their established German names, same as
  // wantedAufloesung.ts/wantedListe.ts that call them — see the Phase 2a report.
  wantedListe: {
    mappings: mit(db)(wantedListe.mappings),
    numbersInCatalog: mit(db)(wantedListe.numbersInCatalog),
    colorsToBlColors: mit(db)(wantedListe.colorsToBlColors),
    colorsToIds: mit(db)(wantedListe.colorsToIds),
    partsDescription: mit(db)(wantedListe.partsDescription),
    partColorImages: mit(db)(wantedListe.partColorImages),
    minifigsDescription: mit(db)(wantedListe.minifigsDescription),
    setsDescription: mit(db)(wantedListe.setsDescription),
  },
});
export type WantedContext = Kontext<WantedDependencies, ReturnType<typeof access>>;
