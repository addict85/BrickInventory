/** What the services receive; separate from area.ts so that no import cycle arises. */
import { bound, withContract, type Context } from '../infra/area';
import type { CatalogReadContract } from './readContract';
import type { Compartments } from '../infra/cache';
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
  faecher: Compartments;
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
    countInstructions: bound(db)(anleitungen.countInstructions),
    instructionsOfSets: bound(db)(anleitungen.instructionsOfSets),
    deleteInstructionsOfSets: bound(db)(anleitungen.deleteInstructionsOfSets),
    hatBrickinstructions: bound(db)(anleitungen.hatBrickinstructions),
    rememberInstruction: bound(db)(anleitungen.storeInstruction),
    setInstructionFile: bound(db)(anleitungen.setInstructionFile),
  },
  blMapping: {
    writeBlNumber: bound(db)(blMapping.writeBlNumber),
    writeBlNumberOwn: bound(db)(blMapping.writeBlNumberOwn),
    noteLookedUp: bound(db)(blMapping.noteLookedUp),
    differingNumber: bound(db)(blMapping.differingNumber),
    effectiveNumber: bound(db)(blMapping.effectiveNumber),
    effectiveNumbers: bound(db)(blMapping.effectiveNumbers),
    writeBlColorNumber: bound(db)(blMapping.writeBlColorNumber),
  },
  csvCatalog: {
    catalogImageStatus: bound(db)(csvCatalog.catalogImageStatus),
    inventoryPartsWithoutFallback: bound(db)(csvCatalog.inventoryPartsWithoutFallback),
    inventoryMinifigs: bound(db)(csvCatalog.inventoryMinifigs),
    setsWithoutPartCatalog: bound(db)(csvCatalog.setsWithoutPartCatalog),
    manualColorParts: withContract(db, l)(csvCatalog.manualColorParts),
    replacePartColorsImage: bound(db)(csvCatalog.replacePartColorsImage),
  },
  catalogCache: {
    catalogEntryTo: bound(db)(catalogCache.catalogEntryTo),
    setInCatalog: bound(db)(catalogCache.setInCatalog),
    rememberBricklinkKind: bound(db)(catalogCache.rememberBricklinkKind),
    emptySubsetsCache: bound(db)(catalogCache.emptySubsetsCache),
    emptyCatalogCache: bound(db)(catalogCache.emptyCatalogCache),
    cacheNumbers: bound(db)(catalogCache.cacheNumbers),
    blTypesTheSets: bound(db)(catalogCache.blTypesTheSets),
    rememberBlType: bound(db)(catalogCache.rememberBlType),
  },
});

/** Master data, search, cache and contents of the sets. */
const masterAccess = (db: Db, l: CatalogReadContract) => ({
  catalogMaster: {
    inventoryAfterCandidates: bound(db)(catalogMaster.inventoryAfterCandidates),
    loadedColors: bound(db)(catalogMaster.loadedColors),
    partFromCatalog: bound(db)(catalogMaster.partFromCatalog),
    minifigFromCatalog: bound(db)(catalogMaster.minifigFromCatalog),
  },
  catalogSearch: {
    themes: bound(db)(catalogSearch.themes),
    setsJeThema: bound(db)(catalogSearch.setsJeThema),
    yearRange: bound(db)(catalogSearch.yearRange),
    setsJeYear: bound(db)(catalogSearch.setsJeYear),
    setsJeYearFiltered: bound(db)(catalogSearch.setsJeYearFiltered),
    catalogCount: bound(db)(catalogSearch.catalogCount),
    catalogRows: withContract(db, l)(catalogSearch.catalogRows),
    catalogRow: withContract(db, l)(catalogSearch.catalogRow),
    catalogEmpty: bound(db)(catalogSearch.catalogEmpty),
    minifigsInInventory: bound(db)(catalogSearch.minifigsOfInventory),
  },
  rebrickableCache: {
    catalogSetTo: bound(db)(rebrickableCache.catalogSetTo),
    rememberUnknownSet: bound(db)(rebrickableCache.rememberUnknownSet),
    rememberSet: bound(db)(rebrickableCache.rememberSet),
    partListFromCache: bound(db)(rebrickableCache.partListFromCache),
    rememberPartList: bound(db)(rebrickableCache.rememberPartList),
    minifigsPartsFromCache: bound(db)(rebrickableCache.minifigsPartsFromCache),
    rememberMinifigsParts: bound(db)(rebrickableCache.rememberMinifigsParts),
    inventoryParts: bound(db)(rebrickableCache.inventoryParts),
  },
  setContent: {
    minifigsOfSetCatalog: bound(db)(setContent.minifigsOfSetCatalog),
    partsWithoutBlMapping: withContract(db, l)(setContent.partsWithoutBlMapping),
  },
  partsEnrichment: {
    partsOfInventory: bound(db)(partsEnrichment.partsOfInventory),
    setPartsCatalog: bound(db)(partsEnrichment.setPartsCatalog),
    blMappings: bound(db)(partsEnrichment.blMappings),
    minifigsInSetCatalog: bound(db)(partsEnrichment.minifigsInSetCatalog),
    imagesWithoutFile: bound(db)(partsEnrichment.imagesWithoutFile),
    minifigsOfSets: bound(db)(partsEnrichment.minifigsOfSets),
    inventoriesTheMinifigs: bound(db)(partsEnrichment.inventoriesTheMinifigs),
    localImagesWithAddress: bound(db)(partsEnrichment.localImagesWithAddress),
    forgetLocalImage: bound(db)(partsEnrichment.forgetLocalImage),
    lockConnection: bound(db)(partsEnrichment.lockConnection),
  },
});

const imageAccess = (db: Db, l: CatalogReadContract) => ({
  imageState: {
    setsWithMissingCatalogImages: bound(db)(imageState.setsWithMissingCatalogImages),
    manualPartsWithoutImage: withContract(db, l)(imageState.manualPartsWithoutImage),
    minifigsWithoutImage: withContract(db, l)(imageState.minifigsWithoutImage),
    setImagesWithoutFile: withContract(db, l)(imageState.setImagesWithoutFile),
    rememberSetImageLocal: bound(db)(imageState.rememberSetImageLocal),
    localCatalogImages: bound(db)(imageState.localCatalogImages),
    partImages: bound(db)(imageState.partImages),
    minifigImages: bound(db)(imageState.minifigImages),
    fillSetGaps: bound(db)(imageState.fillSetGaps),
    setsWithoutInstructionFetch: withContract(db, l)(imageState.setsWithoutInstructionFetch),
    missingCatalogImages: bound(db)(imageState.missingCatalogImages),
    setNames: bound(db)(imageState.setNames),
  },
});

export const access = (db: Db, l: CatalogReadContract) => ({
  ...instructionAccess(db, l),
  ...masterAccess(db, l),
  ...imageAccess(db, l),
});
export type CatalogContext = Context<CatalogDependencies, ReturnType<typeof access>>;
