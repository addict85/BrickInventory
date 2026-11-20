/** Die Fabrik des Bereichs: Dienste als Closure über k (buildArea, src/infra/bereich.ts). Wer eine eigene Sperrverbindung hält, ruft das Repository direkt damit auf. */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as imageStateService from './imageState';
import * as blMappingService from './blMapping';
import * as bricklinkLink from './bricklinkLink';
import * as bricklinkPreise from './bricklinkPrices';
import * as bricksetNachlauf from './bricksetFollowUp';
import * as dienst from './service';
import * as farben from './colors';
import * as instructions from './instructions';
import * as katalogAbgleich from './catalogSync';
import * as katalogPflege from './catalogMaintenance';
import * as minifigsImport from './minifigsImport';
import * as partsImport from './partsImport';
import * as rbInventar from './rbInventory';
import * as rebrickableKatalog from './rebrickableCatalog';
import * as partsEnrichmentService from './partsEnrichment';
import { ConcurrentRateLimiter } from '../externalSources';
import * as pdfAuftraege from './pdf/pdfJobs';
import * as anleitungsAuftrag from './instructionJob';
import * as setStamm from './setMaster';
import { catalogJobTypes } from './jobTypes';
import { zugang, type CatalogDependencies, type CatalogContext } from './context';

export type { CatalogDependencies, CatalogContext } from './context';

export function createCatalog(
  a: Omit<CatalogDependencies, 'faecher' | 'cdnDrossel'>,
  inspect?: Inspect<CatalogContext>,
) {
  const cdnDrossel = new ConcurrentRateLimiter(2, 1000, a.uhr);
  const d = buildArea(
    { ...a, cdnDrossel, faecher: new Faecher() },
    (db: Db) => zugang(db, a.lesevertrag),
    catalogServices,
    inspect,
  );
  return d;
}

function imageServices(k: CatalogContext) {
  return {
    fillFromBrickset: mit(k)(imageStateService.fillFromBrickset),
    backfillInstructions: mit(k)(imageStateService.backfillInstructions),
    reloadSetImages: mit(k)(imageStateService.reloadSetImages),
    backfillThumbnails: mit(k)(imageStateService.backfillThumbnails),
    enterSetImageLocal: mit(k)(imageStateService.enterSetImageLocal),
  };
}

function catalogServices(k: CatalogContext) {
  return {
    ...imageServices(k),
    rememberBlNumber: mit(k)(blMappingService.rememberBlNumber),
    rememberOwnBlNumber: mit(k)(blMappingService.rememberOwnBlNumber),
    blNumberOf: mit(k)(blMappingService.blNumberOf),
    blFetchNumber: mit(k)(blMappingService.blFetchNumber),
    blFetchNumbers: mit(k)(blMappingService.blFetchNumbers),
    merkeBlFarbnummer: mit(k)(blMappingService.merkeBlFarbnummer),
    resolveBlLinks: mit(k)(bricklinkLink.resolveMany),
    resolveBlLink: mit(k)(bricklinkLink.resolveSingle),
    setKnownInCatalog: mit(k)(bricklinkPreise.setKnownInCatalog),
    catalogEntry: mit(k)(bricklinkPreise.catalogEntry),
    emptySubsetsCache: mit(k)(bricklinkPreise.clearSubsetsCache),
    emptyCatalogCache: mit(k)(bricklinkPreise.clearCatalogCache),
    cacheStand: mit(k)(bricklinkPreise.getCacheStats),
    priceGuide: mit(k)(bricklinkPreise.priceGuideQuery),
    bricksetList: mit(k)(bricksetNachlauf.bricksetList),
    anleitungEinreihen: mit(k)(anleitungsAuftrag.anleitungEinreihen),
    catalogMeta: mit(k)(dienst.catalogMeta),
    yearDistribution: mit(k)(dienst.yearDistribution),
    catalogPage: mit(k)(dienst.catalogPage),
    catalogLoaded: mit(k)(dienst.catalogLoaded),
    catalogSet: mit(k)(dienst.catalogSet),
    colorList: mit(k)(farben.colorList),
    anzahlAnleitungen: mit(k)(instructions.anzahlAnleitungen),
    instructionsToSet: mit(k)(instructions.instructionsToSet),
    instructionNewLoadAllowed: mit(k)(instructions.instructionNewLoadAllowed),
    deleteInstructions: mit(k)(instructions.deleteInstructions),
    loadSetInstructions: mit(k)(instructions.setAnleitungenLaden),
    sameMissingAb: mit(k)(katalogAbgleich.syncAllMissing),
    backfillPartColorsImages: mit(k)(katalogAbgleich.backfillPartColorsImages),
    rememberPart: mit(k)(katalogPflege.rememberPart),
    rememberPartColor: mit(k)(katalogPflege.rememberPartColor),
    rememberMinifig: mit(k)(katalogPflege.rememberMinifig),
    merkeSetFiguren: mit(k)(katalogPflege.merkeSetFiguren),
    catalogPart: mit(k)(katalogPflege.catalogPart),
    catalogMinifig: mit(k)(katalogPflege.catalogMinifig),
    minifigsFromCatalog: mit(k)(minifigsImport.minifigsFromCatalog),
    loadSetMinifigs: mit(k)(minifigsImport.loadSetMinifigs),
    setFigurenMerken: mit(k)(minifigsImport.setFigurenMerken),
    loadSetParts: mit(k)(partsImport.loadSetParts),
    setTeileMerken: mit(k)(partsImport.setTeileMerken),
    enqueueSetPartImages: mit(k)(partsImport.enqueueSetPartImages),
    reloadBlNumbers: mit(k)(partsImport.reloadBlNumbers),
    inventoryForCandidates: mit(k)(rbInventar.inventoryForCandidates),
    newestInventory: mit(k)(rbInventar.newestInventory),
    setInfo: mit(k)(rebrickableKatalog.setAngaben),
    allSetParts: mit(k)(rebrickableKatalog.alleTeileDesSets),
    minifigParts: mit(k)(rebrickableKatalog.minifigPartsQuery),
    enrichSetPartsAn: mit(k)(partsEnrichmentService.enrichSetParts),
    loadSetImages: mit(k)(partsEnrichmentService.downloadSetImages),
    enrichSetMinifigsAn: mit(k)(partsEnrichmentService.enrichSetMinifigs),
    /** PDF-Aufträge eines Kontos: anstossen, verfolgen, verwerfen; das Aufräumen über alle. */
    pdf: {
      starten: mit(k)(pdfAuftraege.startPdfJob),
      lies: mit(k)(pdfAuftraege.readJob),
      finishedFile: mit(k)(pdfAuftraege.finishedFile),
      loesche: mit(k)(pdfAuftraege.deleteJob),
      raeumeAuf: mit(k)(pdfAuftraege.cleanOldPdfJobs),
    },
    catalogStatus: mit(k.db, setStamm.catalogStatus),
    rememberCatalogPlaceholder: mit(k.db, setStamm.rememberCatalogPlaceholder),
    rememberSetCatalog: mit(k.db, setStamm.rememberSetCatalog),
    auftragsarten: (importProcess: string) => catalogJobTypes(k, importProcess),
  };
}

export type CatalogServices = ReturnType<typeof createCatalog>;
