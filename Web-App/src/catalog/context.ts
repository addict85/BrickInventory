/** What the services receive; separate from area.ts so that no import cycle arises. */
import { withValue, withContract, type Context } from '../infra/area';
import type { CatalogReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import type { ConcurrentRateLimiter, ForeignSourcesServices } from '../externalSources';
import type { JobsServices } from '../jobQueue';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { ImagesServices } from '../images';
import * as anleitungen from './repository/instructions';
import * as imageState from './repository/imageState';
import * as blMapping from './repository/blMapping';
import * as csvCatalog from './repository/csvCatalog';
import * as catalogCache from './repository/catalogCache';
import * as catalogMaster from './repository/catalogMaster';
import * as catalogSearch from './repository/catalogSearch';
import * as rebrickableCache from './repository/rebrickableCache';
import * as setContent from './repository/setContent';
import * as partsEnrichment from './repository/partsEnrichment';
import type { Clock } from '../infra/clock';

export interface CatalogDependencies {
  uhr: Clock;
  db: Db;
  faecher: Faecher;
  /** Clients, quota and throttles of this set of services (src/externalSources). */
  externalSources: ForeignSourcesServices;
  /** At most two image fetches from the CDN at a time, one per set of services. */
  cdnDrossel: ConcurrentRateLimiter;
  images: ImagesServices;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  throttle: ThrottleServices;
  lesevertrag: CatalogReadContract;
}

/** Instructions, BrickLink mapping and CSV catalog. */
const instructionAccess = (db: Db, l: CatalogReadContract) => ({
  anleitungen: {
    zaehleAnleitungen: withValue(db)(anleitungen.countInstructions),
    instructionsOfSets: withValue(db)(anleitungen.instructionsOfSets),
    deleteInstructionsOfSets: withValue(db)(anleitungen.deleteInstructionsOfSets),
    hatBrickinstructions: withValue(db)(anleitungen.hatBrickinstructions),
    rememberInstruction: withValue(db)(anleitungen.storeInstruction),
    setInstructionFile: withValue(db)(anleitungen.setInstructionFile),
  },
  blZuordnung: {
    writeBlNumber: withValue(db)(blMapping.writeBlNumber),
    writeBlNumberOwn: withValue(db)(blMapping.writeBlNumberOwn),
    noteLookedUp: withValue(db)(blMapping.noteLookedUp),
    differingNumber: withValue(db)(blMapping.differingNumber),
    effectiveNumber: withValue(db)(blMapping.effectiveNumber),
    effectiveNumbers: withValue(db)(blMapping.effectiveNumbers),
    writeBlColorNumber: withValue(db)(blMapping.writeBlColorNumber),
  },
  csvKatalog: {
    catalogImageStatus: withValue(db)(csvCatalog.catalogImageStatus),
    inventoryPartsWithoutFallback: withValue(db)(csvCatalog.inventoryPartsWithoutFallback),
    inventoryMinifigs: withValue(db)(csvCatalog.inventoryMinifigs),
    setsWithoutPartCatalog: withValue(db)(csvCatalog.setsWithoutPartCatalog),
    manualColorParts: withContract(db, l)(csvCatalog.manualColorParts),
    replacePartColorsImage: withValue(db)(csvCatalog.replacePartColorsImage),
  },
  katalogCache: {
    catalogEntryTo: withValue(db)(catalogCache.catalogEntryTo),
    setInCatalog: withValue(db)(catalogCache.setInCatalog),
    rememberBricklinkKind: withValue(db)(catalogCache.rememberBricklinkKind),
    emptySubsetsCache: withValue(db)(catalogCache.emptySubsetsCache),
    emptyCatalogCache: withValue(db)(catalogCache.emptyCatalogCache),
    cacheNumbers: withValue(db)(catalogCache.cacheNumbers),
    blTypesTheSets: withValue(db)(catalogCache.blTypesTheSets),
    rememberBlType: withValue(db)(catalogCache.rememberBlType),
  },
});

/** Master data, search, cache and contents of the sets. */
const masterAccess = (db: Db, l: CatalogReadContract) => ({
  katalogStamm: {
    inventoryAfterCandidates: withValue(db)(catalogMaster.inventoryAfterCandidates),
    loadedColors: withValue(db)(catalogMaster.loadedColors),
    partFromCatalog: withValue(db)(catalogMaster.partFromCatalog),
    minifigFromCatalog: withValue(db)(catalogMaster.minifigFromCatalog),
  },
  katalogSuche: {
    themen: withValue(db)(catalogSearch.themes),
    setsJeThema: withValue(db)(catalogSearch.setsJeThema),
    jahresspanne: withValue(db)(catalogSearch.yearRange),
    setsJeYear: withValue(db)(catalogSearch.setsJeYear),
    setsJeYearFiltered: withValue(db)(catalogSearch.setsJeYearFiltered),
    catalogCount: withValue(db)(catalogSearch.catalogCount),
    catalogRows: withContract(db, l)(catalogSearch.catalogRows),
    catalogRow: withContract(db, l)(catalogSearch.catalogRow),
    catalogEmpty: withValue(db)(catalogSearch.catalogEmpty),
    minifigsInInventory: withValue(db)(catalogSearch.minifigsOfInventory),
  },
  rebrickableCache: {
    catalogSetTo: withValue(db)(rebrickableCache.catalogSetTo),
    rememberUnknownSet: withValue(db)(rebrickableCache.rememberUnknownSet),
    rememberSet: withValue(db)(rebrickableCache.rememberSet),
    partListFromCache: withValue(db)(rebrickableCache.partListFromCache),
    rememberPartList: withValue(db)(rebrickableCache.rememberPartList),
    minifigsPartsFromCache: withValue(db)(rebrickableCache.minifigsPartsFromCache),
    rememberMinifigsParts: withValue(db)(rebrickableCache.rememberMinifigsParts),
    inventoryParts: withValue(db)(rebrickableCache.inventoryParts),
  },
  setInhalt: {
    minifigsOfSetkatalogs: withValue(db)(setContent.minifigsOfSetCatalog),
    partsWithoutBlMapping: withContract(db, l)(setContent.partsWithoutBlMapping),
  },
  teileAnreicherung: {
    partsOfInventory: withValue(db)(partsEnrichment.partsOfInventory),
    setPartsCatalog: withValue(db)(partsEnrichment.setPartsCatalog),
    blMappings: withValue(db)(partsEnrichment.blMappings),
    minifigsInSetkatalog: withValue(db)(partsEnrichment.minifigsInSetCatalog),
    imagesWithoutFile: withValue(db)(partsEnrichment.imagesWithoutFile),
    minifigsOfSets: withValue(db)(partsEnrichment.minifigsOfSets),
    inventoriesTheMinifigs: withValue(db)(partsEnrichment.inventoriesTheMinifigs),
    localImagesWithAddress: withValue(db)(partsEnrichment.localImagesWithAddress),
    forgetLocalImage: withValue(db)(partsEnrichment.forgetLocalImage),
    lockConnection: withValue(db)(partsEnrichment.lockConnection),
  },
});

const imageAccess = (db: Db, l: CatalogReadContract) => ({
  bildlage: {
    setsWithMissingCatalogImages: withValue(db)(imageState.setsWithMissingCatalogImages),
    manualPartsWithoutImage: withContract(db, l)(imageState.manualPartsWithoutImage),
    minifigsWithoutImage: withContract(db, l)(imageState.minifigsWithoutImage),
    setImagesWithoutFile: withContract(db, l)(imageState.setImagesWithoutFile),
    rememberSetImageLocal: withValue(db)(imageState.rememberSetImageLocal),
    localCatalogImages: withValue(db)(imageState.localCatalogImages),
    partImages: withValue(db)(imageState.partImages),
    minifigImages: withValue(db)(imageState.minifigImages),
    fillSetGaps: withValue(db)(imageState.fillSetGaps),
    setsWithoutInstructionFetch: withContract(db, l)(imageState.setsWithoutInstructionFetch),
    missingCatalogImages: withValue(db)(imageState.missingCatalogImages),
    setNames: withValue(db)(imageState.setNames),
  },
});

export const access = (db: Db, l: CatalogReadContract) => ({
  ...instructionAccess(db, l),
  ...masterAccess(db, l),
  ...imageAccess(db, l),
});
export type CatalogContext = Context<CatalogDependencies, ReturnType<typeof access>>;
