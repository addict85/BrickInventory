/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). Whoever holds a lock connection of their own calls the repository directly with it. */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
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
import * as rebrickableKatalog from './rebrickableCatalog';
import * as partsEnrichmentService from './partsEnrichment';
import { ConcurrentRateLimiter } from '../externalSources';
import * as pdfJobs from './pdf/pdfJobs';
import * as anleitungsAuftrag from './instructionJob';
import * as setStamm from './setMaster';
import { catalogJobTypes } from './jobTypes';
import { access, type CatalogDependencies, type CatalogContext } from './context';

export type { CatalogDependencies, CatalogContext } from './context';

export function createCatalog(
  a: Omit<CatalogDependencies, 'faecher' | 'cdnDrossel'>,
  inspect?: Inspect<CatalogContext>,
) {
  const cdnDrossel = new ConcurrentRateLimiter(2, 1000, a.uhr);
  const d = buildArea(
    { ...a, cdnDrossel, faecher: new Faecher() },
    (db: Db) => access(db, a.lesevertrag),
    catalogServices,
    inspect,
  );
  return d;
}

function imageServices(k: CatalogContext) {
  return {
    fillFromBrickset: withValue(k)(imageStateService.fillFromBrickset),
    backfillInstructions: withValue(k)(imageStateService.backfillInstructions),
    reloadSetImages: withValue(k)(imageStateService.reloadSetImages),
    backfillThumbnails: withValue(k)(imageStateService.backfillThumbnails),
    enterSetImageLocal: withValue(k)(imageStateService.enterSetImageLocal),
  };
}

function catalogServices(k: CatalogContext) {
  return {
    ...imageServices(k),
    rememberBlNumber: withValue(k)(blMappingService.rememberBlNumber),
    rememberOwnBlNumber: withValue(k)(blMappingService.rememberOwnBlNumber),
    blNumberOf: withValue(k)(blMappingService.blNumberOf),
    blFetchNumber: withValue(k)(blMappingService.blFetchNumber),
    blFetchNumbers: withValue(k)(blMappingService.blFetchNumbers),
    merkeBlFarbnummer: withValue(k)(blMappingService.rememberBlColorNumber),
    resolveBlLinks: withValue(k)(bricklinkLink.resolveMany),
    resolveBlLink: withValue(k)(bricklinkLink.resolveSingle),
    setKnownInCatalog: withValue(k)(bricklinkPrices.setKnownInCatalog),
    catalogEntry: withValue(k)(bricklinkPrices.catalogEntry),
    emptySubsetsCache: withValue(k)(bricklinkPrices.clearSubsetsCache),
    emptyCatalogCache: withValue(k)(bricklinkPrices.clearCatalogCache),
    cacheStand: withValue(k)(bricklinkPrices.getCacheStats),
    priceGuide: withValue(k)(bricklinkPrices.priceGuideQuery),
    bricksetList: withValue(k)(bricksetFollowUp.bricksetList),
    anleitungEinreihen: withValue(k)(anleitungsAuftrag.anleitungEinreihen),
    catalogMeta: withValue(k)(service.catalogMeta),
    yearDistribution: withValue(k)(service.yearDistribution),
    catalogPage: withValue(k)(service.catalogPage),
    catalogLoaded: withValue(k)(service.catalogLoaded),
    catalogSet: withValue(k)(service.catalogSet),
    colorList: withValue(k)(colors.colorList),
    anzahlAnleitungen: withValue(k)(instructions.instructionCount),
    instructionsToSet: withValue(k)(instructions.instructionsToSet),
    instructionNewLoadAllowed: withValue(k)(instructions.instructionNewLoadAllowed),
    deleteInstructions: withValue(k)(instructions.deleteInstructions),
    loadSetInstructions: withValue(k)(instructions.setAnleitungenLaden),
    sameMissingAb: withValue(k)(catalogReconcile.syncAllMissing),
    backfillPartColorsImages: withValue(k)(catalogReconcile.backfillPartColorsImages),
    rememberPart: withValue(k)(catalogMaintenance.rememberPart),
    rememberPartColor: withValue(k)(catalogMaintenance.rememberPartColor),
    rememberMinifig: withValue(k)(catalogMaintenance.rememberMinifig),
    merkeSetFiguren: withValue(k)(catalogMaintenance.merkeSetFiguren),
    catalogPart: withValue(k)(catalogMaintenance.catalogPart),
    catalogMinifig: withValue(k)(catalogMaintenance.catalogMinifig),
    minifigsFromCatalog: withValue(k)(minifigsImport.minifigsFromCatalog),
    loadSetMinifigs: withValue(k)(minifigsImport.loadSetMinifigs),
    setFigurenMerken: withValue(k)(minifigsImport.setFigurenMerken),
    loadSetParts: withValue(k)(partsImport.loadSetParts),
    setTeileMerken: withValue(k)(partsImport.setTeileMerken),
    enqueueSetPartImages: withValue(k)(partsImport.enqueueSetPartImages),
    reloadBlNumbers: withValue(k)(partsImport.reloadBlNumbers),
    inventoryForCandidates: withValue(k)(rbInventory.inventoryForCandidates),
    newestInventory: withValue(k)(rbInventory.newestInventory),
    setInfo: withValue(k)(rebrickableKatalog.setAngaben),
    allSetParts: withValue(k)(rebrickableKatalog.alleTeileDesSets),
    minifigParts: withValue(k)(rebrickableKatalog.minifigPartsQuery),
    enrichSetPartsAn: withValue(k)(partsEnrichmentService.enrichSetParts),
    loadSetImages: withValue(k)(partsEnrichmentService.downloadSetImages),
    enrichSetMinifigsAn: withValue(k)(partsEnrichmentService.enrichSetMinifigs),
    /** PDF jobs of an account: trigger, track, discard; the cleanup across all. */
    pdf: {
      starten: withValue(k)(pdfJobs.startPdfJob),
      lies: withValue(k)(pdfJobs.readJob),
      finishedFile: withValue(k)(pdfJobs.finishedFile),
      loesche: withValue(k)(pdfJobs.deleteJob),
      raeumeAuf: withValue(k)(pdfJobs.cleanOldPdfJobs),
    },
    catalogStatus: withValue(k.db, setStamm.catalogStatus),
    rememberCatalogPlaceholder: withValue(k.db, setStamm.rememberCatalogPlaceholder),
    rememberSetCatalog: withValue(k.db, setStamm.rememberSetCatalog),
    auftragsarten: (importProcess: string) => catalogJobTypes(k, importProcess),
  };
}

export type CatalogServices = ReturnType<typeof createCatalog>;
