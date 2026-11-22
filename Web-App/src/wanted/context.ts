/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { withValue, type Context } from '../infra/area';
import * as wanted from './repository/wanted';
import * as wantedListe from './repository/wantedList';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { CatalogServices } from '../catalog';
import type { FinancesServices } from '../finances';
import type { SetsServices } from '../sets';
import type { ForeignSourcesServices } from '../externalSources';
import type { ImagesServices } from '../images';
import type { Clock } from '../infra/clock';

export interface WantedDependencies {
  uhr: Clock;
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
    markSetWanted: withValue(db)(wanted.markSetWanted),
    removeWantedEntry: withValue(db)(wanted.removeWantedEntry),
    isWanted: withValue(db)(wanted.isWanted),
    transferWantedEntry: withValue(db)(wanted.transferWantedEntry),
    wantedListInScope: withValue(db)(wanted.wantedListInScope),
    wantedListForExport: withValue(db)(wanted.wantedListForExport),
  },
  // Cross-reference lookups for the BrickLink wanted-list XML import (BL→RB
  // number mapping); left under their established German names, same as
  // wantedResolution.ts/wantedListe.ts that call them — see the Phase 2a report.
  wantedListe: {
    mappings: withValue(db)(wantedListe.mappings),
    numbersInCatalog: withValue(db)(wantedListe.numbersInCatalog),
    colorsToBlColors: withValue(db)(wantedListe.colorsToBlColors),
    colorsToIds: withValue(db)(wantedListe.colorsToIds),
    partsDescription: withValue(db)(wantedListe.partsDescription),
    partColorImages: withValue(db)(wantedListe.partColorImages),
    minifigsDescription: withValue(db)(wantedListe.minifigsDescription),
    setsDescription: withValue(db)(wantedListe.setsDescription),
  },
});
export type WantedContext = Context<WantedDependencies, ReturnType<typeof access>>;
