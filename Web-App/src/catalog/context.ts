/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import { mit, withContract, type Kontext } from '../infra/bereich';
import type { CatalogReadContract } from './readContract';
import type { Faecher } from '../infra/zwischenspeicher';
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import type { ConcurrentRateLimiter, ForeignSourcesServices } from '../externalSources';
import type { JobsServices } from '../jobQueue';
import type { SettingsServices } from '../settings';
import type { HouseholdServices } from '../household';
import type { ImagesServices } from '../images';
import * as anleitungen from './repository/instructions';
import * as bildlage from './repository/imageState';
import * as blZuordnung from './repository/blMapping';
import * as csvKatalog from './repository/csvCatalog';
import * as katalogCache from './repository/catalogCache';
import * as katalogStamm from './repository/catalogMaster';
import * as katalogSuche from './repository/catalogSearch';
import * as rebrickableCache from './repository/rebrickableCache';
import * as setInhalt from './repository/setContent';
import * as teileAnreicherung from './repository/partsEnrichment';
import type { Uhr } from '../infra/uhr';

export interface CatalogDependencies {
  uhr: Uhr;
  db: Db;
  faecher: Faecher;
  /** Klienten, Kontingent und Drosseln dieses Satzes Dienste (src/externalSources). */
  externalSources: ForeignSourcesServices;
  /** Höchstens zwei Bildabrufe beim CDN zugleich, je Satz Dienste einer. */
  cdnDrossel: ConcurrentRateLimiter;
  images: ImagesServices;
  einstellungen: SettingsServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  throttle: ThrottleServices;
  lesevertrag: CatalogReadContract;
}

/** Anleitungen, BrickLink-Zuordnung und CSV-Katalog. */
const anleitungszugang = (db: Db, l: CatalogReadContract) => ({
  anleitungen: {
    zaehleAnleitungen: mit(db)(anleitungen.zaehleAnleitungen),
    instructionsOfSets: mit(db)(anleitungen.instructionsOfSets),
    deleteInstructionsOfSets: mit(db)(anleitungen.deleteInstructionsOfSets),
    hatBrickinstructions: mit(db)(anleitungen.hatBrickinstructions),
    rememberInstruction: mit(db)(anleitungen.storeInstruction),
    setInstructionFile: mit(db)(anleitungen.setInstructionFile),
  },
  blZuordnung: {
    writeBlNumber: mit(db)(blZuordnung.writeBlNumber),
    writeBlNumberOwn: mit(db)(blZuordnung.writeBlNumberOwn),
    noteLookedUp: mit(db)(blZuordnung.noteLookedUp),
    differingNumber: mit(db)(blZuordnung.differingNumber),
    effectiveNumber: mit(db)(blZuordnung.effectiveNumber),
    effectiveNumbers: mit(db)(blZuordnung.effectiveNumbers),
    writeBlColorNumber: mit(db)(blZuordnung.writeBlColorNumber),
  },
  csvKatalog: {
    catalogImageStatus: mit(db)(csvKatalog.catalogImageStatus),
    inventoryPartsWithoutFallback: mit(db)(csvKatalog.inventoryPartsWithoutFallback),
    inventoryMinifigs: mit(db)(csvKatalog.inventoryMinifigs),
    setsWithoutPartCatalog: mit(db)(csvKatalog.setsWithoutPartCatalog),
    manualColorParts: withContract(db, l)(csvKatalog.manualColorParts),
    replacePartColorsImage: mit(db)(csvKatalog.replacePartColorsImage),
  },
  katalogCache: {
    catalogEntryTo: mit(db)(katalogCache.catalogEntryTo),
    setInCatalog: mit(db)(katalogCache.setInCatalog),
    rememberBricklinkKind: mit(db)(katalogCache.rememberBricklinkKind),
    emptySubsetsCache: mit(db)(katalogCache.emptySubsetsCache),
    emptyCatalogCache: mit(db)(katalogCache.emptyCatalogCache),
    cacheNumbers: mit(db)(katalogCache.cacheNumbers),
    blTypesTheSets: mit(db)(katalogCache.blTypesTheSets),
    rememberBlType: mit(db)(katalogCache.rememberBlType),
  },
});

/** Stamm, Suche, Zwischenspeicher und Inhalt der Sets. */
const stammzugang = (db: Db, l: CatalogReadContract) => ({
  katalogStamm: {
    inventoryAfterCandidates: mit(db)(katalogStamm.inventoryAfterCandidates),
    loadedColors: mit(db)(katalogStamm.loadedColors),
    partFromCatalog: mit(db)(katalogStamm.partFromCatalog),
    minifigFromCatalog: mit(db)(katalogStamm.minifigFromCatalog),
  },
  katalogSuche: {
    themen: mit(db)(katalogSuche.themen),
    setsJeThema: mit(db)(katalogSuche.setsJeThema),
    jahresspanne: mit(db)(katalogSuche.jahresspanne),
    setsJeYear: mit(db)(katalogSuche.setsJeYear),
    setsJeYearFiltered: mit(db)(katalogSuche.setsJeYearFiltered),
    catalogCount: mit(db)(katalogSuche.catalogCount),
    catalogRows: withContract(db, l)(katalogSuche.catalogRows),
    catalogRow: withContract(db, l)(katalogSuche.catalogRow),
    catalogEmpty: mit(db)(katalogSuche.catalogEmpty),
    minifigsInInventory: mit(db)(katalogSuche.minifigsOfInventory),
  },
  rebrickableCache: {
    catalogSetTo: mit(db)(rebrickableCache.catalogSetTo),
    rememberUnknownSet: mit(db)(rebrickableCache.rememberUnknownSet),
    rememberSet: mit(db)(rebrickableCache.rememberSet),
    partListFromCache: mit(db)(rebrickableCache.partListFromCache),
    rememberPartList: mit(db)(rebrickableCache.rememberPartList),
    minifigsPartsFromCache: mit(db)(rebrickableCache.minifigsPartsFromCache),
    rememberMinifigsParts: mit(db)(rebrickableCache.rememberMinifigsParts),
    inventoryParts: mit(db)(rebrickableCache.inventoryParts),
  },
  setInhalt: {
    minifigsOfSetkatalogs: mit(db)(setInhalt.minifigsOfSetkatalogs),
    partsWithoutBlMapping: withContract(db, l)(setInhalt.partsWithoutBlMapping),
  },
  teileAnreicherung: {
    partsOfInventory: mit(db)(teileAnreicherung.partsOfInventory),
    setPartsCatalog: mit(db)(teileAnreicherung.setPartsCatalog),
    blMappings: mit(db)(teileAnreicherung.blMappings),
    minifigsInSetkatalog: mit(db)(teileAnreicherung.minifigsInSetkatalog),
    imagesWithoutFile: mit(db)(teileAnreicherung.imagesWithoutFile),
    minifigsOfSets: mit(db)(teileAnreicherung.minifigsOfSets),
    inventoriesTheMinifigs: mit(db)(teileAnreicherung.inventoriesTheMinifigs),
    localImagesWithAddress: mit(db)(teileAnreicherung.localImagesWithAddress),
    forgetLocalImage: mit(db)(teileAnreicherung.forgetLocalImage),
    lockConnection: mit(db)(teileAnreicherung.lockConnection),
  },
});

const bildzugang = (db: Db, l: CatalogReadContract) => ({
  bildlage: {
    setsWithMissingCatalogImages: mit(db)(bildlage.setsWithMissingCatalogImages),
    manualPartsWithoutImage: withContract(db, l)(bildlage.manualPartsWithoutImage),
    minifigsWithoutImage: withContract(db, l)(bildlage.minifigsWithoutImage),
    setImagesWithoutFile: withContract(db, l)(bildlage.setImagesWithoutFile),
    rememberSetImageLocal: mit(db)(bildlage.rememberSetImageLocal),
    localCatalogImages: mit(db)(bildlage.localCatalogImages),
    partImages: mit(db)(bildlage.partImages),
    minifigImages: mit(db)(bildlage.minifigImages),
    fillSetGaps: mit(db)(bildlage.fillSetGaps),
    setsWithoutInstructionFetch: withContract(db, l)(bildlage.setsWithoutInstructionFetch),
    missingCatalogImages: mit(db)(bildlage.missingCatalogImages),
    setNames: mit(db)(bildlage.setNames),
  },
});

export const zugang = (db: Db, l: CatalogReadContract) => ({
  ...anleitungszugang(db, l),
  ...stammzugang(db, l),
  ...bildzugang(db, l),
});
export type CatalogContext = Kontext<CatalogDependencies, ReturnType<typeof zugang>>;
