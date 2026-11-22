/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { bound, type Context } from '../infra/area';
import * as wanted from './repository/wanted';
import * as wantedList from './repository/wantedList';
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
    markSetWanted: bound(db)(wanted.markSetWanted),
    removeWantedEntry: bound(db)(wanted.removeWantedEntry),
    isWanted: bound(db)(wanted.isWanted),
    transferWantedEntry: bound(db)(wanted.transferWantedEntry),
    wantedListInScope: bound(db)(wanted.wantedListInScope),
    wantedListForExport: bound(db)(wanted.wantedListForExport),
  },
  // Cross-reference lookups for the BrickLink wanted-list XML import (BL→RB
  // number mapping); left under their established German names, same as
  // wantedResolution.ts/wantedListe.ts that call them — see the Phase 2a report.
  wantedListe: {
    mappings: bound(db)(wantedList.mappings),
    numbersInCatalog: bound(db)(wantedList.numbersInCatalog),
    colorsToBlColors: bound(db)(wantedList.colorsToBlColors),
    colorsToIds: bound(db)(wantedList.colorsToIds),
    partsDescription: bound(db)(wantedList.partsDescription),
    partColorImages: bound(db)(wantedList.partColorImages),
    minifigsDescription: bound(db)(wantedList.minifigsDescription),
    setsDescription: bound(db)(wantedList.setsDescription),
  },
});
export type WantedContext = Context<WantedDependencies, ReturnType<typeof access>>;
