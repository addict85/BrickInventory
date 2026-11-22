/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). Whoever holds a lock connection of their own calls the repository directly with it. */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as imageStateService from './imageState';
import * as blMappingService from './blMapping';
import * as bricklinkLink from './bricklinkLink';
import * as bricklinkPrices from './bricklinkPrices';
import * as bricksetFollowUp from './bricksetFollowUp';
import * as service from './service';
import * as colors from './colors';
import * as instructions from './instructions';
import * as catalogReconcile from './catalogSync';
import * as catalogMaintenance from './catalogMaintenance';
import * as minifigsImport from './minifigsImport';
import * as partsImport from './partsImport';
import * as rbInventory from './rbInventory';
import * as rebrickableCatalog from './rebrickableCatalog';
import * as partsEnrichmentService from './partsEnrichment';
import { ConcurrentRateLimiter } from '../externalSources';
import * as pdfJobs from './pdf/pdfJobs';
import * as instructionJob from './instructionJob';
import * as setMaster from './setMaster';
import { catalogJobTypes } from './jobTypes';
import { access, type CatalogDependencies, type CatalogContext } from './context';

export type { CatalogDependencies, CatalogContext } from './context';

export function createCatalog(
  a: Omit<CatalogDependencies, 'compartments' | 'cdnThrottle'>,
  inspect?: Inspect<CatalogContext>,
) {
  const cdnThrottle = new ConcurrentRateLimiter(2, 1000, a.clock);
  const d = buildArea(
    { ...a, cdnThrottle, compartments: new Compartments() },
    (db: Db) => access(db, a.readContract),
    catalogServices,
    inspect,
  );
  return d;
}

function imageServices(k: CatalogContext) {
  return {
    fillFromBrickset: bound(k)(imageStateService.fillFromBrickset),
    backfillInstructions: bound(k)(imageStateService.backfillInstructions),
    reloadSetImages: bound(k)(imageStateService.reloadSetImages),
    backfillThumbnails: bound(k)(imageStateService.backfillThumbnails),
    enterSetImageLocal: bound(k)(imageStateService.enterSetImageLocal),
  };
}

function catalogServices(k: CatalogContext) {
  return {
    ...imageServices(k),
    rememberBlNumber: bound(k)(blMappingService.rememberBlNumber),
    rememberOwnBlNumber: bound(k)(blMappingService.rememberOwnBlNumber),
    blNumberOf: bound(k)(blMappingService.blNumberOf),
    blFetchNumber: bound(k)(blMappingService.blFetchNumber),
    blFetchNumbers: bound(k)(blMappingService.blFetchNumbers),
    rememberBlColorNumber: bound(k)(blMappingService.rememberBlColorNumber),
    resolveBlLinks: bound(k)(bricklinkLink.resolveMany),
    resolveBlLink: bound(k)(bricklinkLink.resolveSingle),
    setKnownInCatalog: bound(k)(bricklinkPrices.setKnownInCatalog),
    catalogEntry: bound(k)(bricklinkPrices.catalogEntry),
    emptySubsetsCache: bound(k)(bricklinkPrices.clearSubsetsCache),
    emptyCatalogCache: bound(k)(bricklinkPrices.clearCatalogCache),
    cacheStand: bound(k)(bricklinkPrices.getCacheStats),
    priceGuide: bound(k)(bricklinkPrices.priceGuideQuery),
    bricksetList: bound(k)(bricksetFollowUp.bricksetList),
    enqueueInstruction: bound(k)(instructionJob.enqueueInstruction),
    catalogMeta: bound(k)(service.catalogMeta),
    yearDistribution: bound(k)(service.yearDistribution),
    catalogPage: bound(k)(service.catalogPage),
    catalogLoaded: bound(k)(service.catalogLoaded),
    catalogSet: bound(k)(service.catalogSet),
    colorList: bound(k)(colors.colorList),
    instructionCount: bound(k)(instructions.instructionCount),
    instructionsToSet: bound(k)(instructions.instructionsToSet),
    instructionNewLoadAllowed: bound(k)(instructions.instructionNewLoadAllowed),
    deleteInstructions: bound(k)(instructions.deleteInstructions),
    loadSetInstructions: bound(k)(instructions.loadSetInstructions),
    syncAllMissing: bound(k)(catalogReconcile.syncAllMissing),
    backfillPartColorsImages: bound(k)(catalogReconcile.backfillPartColorsImages),
    rememberPart: bound(k)(catalogMaintenance.rememberPart),
    rememberPartColor: bound(k)(catalogMaintenance.rememberPartColor),
    rememberMinifig: bound(k)(catalogMaintenance.rememberMinifig),
    rememberSetMinifigs: bound(k)(catalogMaintenance.rememberSetMinifigs),
    catalogPart: bound(k)(catalogMaintenance.catalogPart),
    catalogMinifig: bound(k)(catalogMaintenance.catalogMinifig),
    minifigsFromCatalog: bound(k)(minifigsImport.minifigsFromCatalog),
    loadSetMinifigs: bound(k)(minifigsImport.loadSetMinifigs),
    rememberSetFigs: bound(k)(minifigsImport.rememberSetFigs),
    loadSetParts: bound(k)(partsImport.loadSetParts),
    rememberSetParts: bound(k)(partsImport.rememberSetParts),
    enqueueSetPartImages: bound(k)(partsImport.enqueueSetPartImages),
    reloadBlNumbers: bound(k)(partsImport.reloadBlNumbers),
    inventoryForCandidates: bound(k)(rbInventory.inventoryForCandidates),
    newestInventory: bound(k)(rbInventory.newestInventory),
    setInfo: bound(k)(rebrickableCatalog.setDetails),
    allSetParts: bound(k)(rebrickableCatalog.allPartsOfSet),
    minifigParts: bound(k)(rebrickableCatalog.minifigPartsQuery),
    enrichSetParts: bound(k)(partsEnrichmentService.enrichSetParts),
    loadSetImages: bound(k)(partsEnrichmentService.downloadSetImages),
    enrichSetMinifigs: bound(k)(partsEnrichmentService.enrichSetMinifigs),
    /** PDF jobs of an account: trigger, track, discard; the cleanup across all. */
    pdf: {
      start: bound(k)(pdfJobs.startPdfJob),
      lies: bound(k)(pdfJobs.readJob),
      finishedFile: bound(k)(pdfJobs.finishedFile),
      remove: bound(k)(pdfJobs.deleteJob),
      cleanUp: bound(k)(pdfJobs.cleanOldPdfJobs),
    },
    catalogStatus: bound(k.db, setMaster.catalogStatus),
    rememberCatalogPlaceholder: bound(k.db, setMaster.rememberCatalogPlaceholder),
    rememberSetCatalog: bound(k.db, setMaster.rememberSetCatalog),
    jobKinds: (importProcess: string) => catalogJobTypes(k, importProcess),
  };
}

export type CatalogServices = ReturnType<typeof createCatalog>;
