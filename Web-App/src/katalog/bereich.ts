/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). Wer eine eigene Sperrverbindung hält, ruft das Repository direkt damit auf. */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anleitungLaden from './anleitungLaden';
import * as blZuordnungDienst from './blZuordnung';
import * as bricklinkLink from './bricklinkLink';
import * as bricklinkPreise from './bricklinkPreise';
import * as bricksetNachlauf from './bricksetNachlauf';
import * as csvAbgleich from './csvAbgleich';
import * as dienst from './dienst';
import * as farben from './farben';
import * as instructions from './instructions';
import * as katalogAbgleich from './katalogAbgleich';
import * as katalogPflege from './katalogPflege';
import * as minifigsImport from './minifigsImport';
import * as partsImport from './partsImport';
import * as rbInventar from './rbInventar';
import * as rebrickableKatalog from './rebrickableKatalog';
import * as teileAnreicherungDienst from './teileAnreicherung';
import { ConcurrentRateLimiter, type FremdquellenDienste } from '../fremdquellen';
import * as bildNachlauf from './bildNachlauf';
import * as pdfErzeugung from './pdf/pdfErzeugung';
import * as widerrufsliste from './widerrufsliste';
import { zugang, type KatalogAbhaengigkeiten, type KatalogKontext } from './kontext';

export type { KatalogAbhaengigkeiten, KatalogKontext } from './kontext';

export function erzeugeKatalog(
  a: Omit<KatalogAbhaengigkeiten, 'faecher' | 'cdnDrossel'>,
  einblick?: Einblick<KatalogKontext>,
) {
  const cdnDrossel = new ConcurrentRateLimiter(2, 1000);
  return baueBereich({ ...a, cdnDrossel, faecher: new Faecher() }, zugang, katalogDienste, einblick);
}

type P<
  N extends
    | 'checkAndIncrementRateLimit'
    | 'getRateLimitStatus'
    | 'kontingentFrei'
    | 'setzeKontingentZurueck'
    | 'getLimitForApi',
> = Parameters<FremdquellenDienste[N]>;

function katalogDienste(k: KatalogKontext) {
  const fq = () => k.fremdquellen;
  return {
    anleitungLaden: mit(k)(anleitungLaden.anleitungLaden),
    // Beim Aufruf nachgeschlagen: Der Bau des Katalogs liest die Fremdquellen nicht.
    checkAndIncrementRateLimit: (...x: P<'checkAndIncrementRateLimit'>) => fq().checkAndIncrementRateLimit(...x),
    getRateLimitStatus: (...x: P<'getRateLimitStatus'>) => fq().getRateLimitStatus(...x),
    kontingentFrei: (...x: P<'kontingentFrei'>) => fq().kontingentFrei(...x),
    setzeKontingentZurueck: (...x: P<'setzeKontingentZurueck'>) => fq().setzeKontingentZurueck(...x),
    getLimitForApi: (...x: P<'getLimitForApi'>) => fq().getLimitForApi(...x),
    rebrickableDailyStatus: () => fq().rebrickableDailyStatus(),
    get quellen() {
      return fq().quellen;
    },
    get bilder() {
      return k.bilder;
    },
    merkeBlNummer: mit(k)(blZuordnungDienst.merkeBlNummer),
    merkeEigeneBlNummer: mit(k)(blZuordnungDienst.merkeEigeneBlNummer),
    blNummerVon: mit(k)(blZuordnungDienst.blNummerVon),
    blAbrufNummer: mit(k)(blZuordnungDienst.blAbrufNummer),
    blAbrufNummern: mit(k)(blZuordnungDienst.blAbrufNummern),
    merkeBlFarbnummer: mit(k)(blZuordnungDienst.merkeBlFarbnummer),
    resolveMany: mit(k)(bricklinkLink.resolveMany),
    resolveOne: mit(k)(bricklinkLink.resolveOne),
    setBekanntImKatalog: mit(k)(bricklinkPreise.setBekanntImKatalog),
    katalogEintrag: mit(k)(bricklinkPreise.katalogEintrag),
    clearSubsetsCache: mit(k)(bricklinkPreise.clearSubsetsCache),
    clearCatalogCache: mit(k)(bricklinkPreise.clearCatalogCache),
    getCacheStats: mit(k)(bricklinkPreise.getCacheStats),
    getPriceGuide: mit(k)(bricklinkPreise.getPriceGuide),
    bricksetNachlauf: mit(k)(bricksetNachlauf.bricksetNachlauf),
    csvAbgleich: mit(k)(csvAbgleich.csvAbgleich),
    katalogMeta: mit(k)(dienst.katalogMeta),
    jahrVerteilung: mit(k)(dienst.jahrVerteilung),
    katalogSeite: mit(k)(dienst.katalogSeite),
    katalogGeladen: mit(k)(dienst.katalogGeladen),
    katalogSet: mit(k)(dienst.katalogSet),
    farbliste: mit(k)(farben.farbliste),
    anzahlAnleitungen: mit(k)(instructions.anzahlAnleitungen),
    anleitungenZuSet: mit(k)(instructions.anleitungenZuSet),
    anleitungNeuLadenErlaubt: mit(k)(instructions.anleitungNeuLadenErlaubt),
    loescheAnleitungen: mit(k)(instructions.loescheAnleitungen),
    downloadSetInstructions: mit(k)(instructions.downloadSetInstructions),
    syncAllMissing: mit(k)(katalogAbgleich.syncAllMissing),
    teilfarbenbilderNachtragen: mit(k)(katalogAbgleich.teilfarbenbilderNachtragen),
    merkeTeil: mit(k)(katalogPflege.merkeTeil),
    merkeTeilFarbe: mit(k)(katalogPflege.merkeTeilFarbe),
    merkeFigur: mit(k)(katalogPflege.merkeFigur),
    merkeSetFiguren: mit(k)(katalogPflege.merkeSetFiguren),
    katalogTeil: mit(k)(katalogPflege.katalogTeil),
    katalogFigur: mit(k)(katalogPflege.katalogFigur),
    figurenAusKatalog: mit(k)(minifigsImport.figurenAusKatalog),
    importiereFiguren: mit(k)(minifigsImport.importiereFiguren),
    importiereTeile: mit(k)(partsImport.importiereTeile),
    blNummernNachladen: mit(k)(partsImport.blNummernNachladen),
    inventarFuerKandidaten: mit(k)(rbInventar.inventarFuerKandidaten),
    neuestesInventar: mit(k)(rbInventar.neuestesInventar),
    getSetInfo: mit(k)(rebrickableKatalog.getSetInfo),
    getAllSetParts: mit(k)(rebrickableKatalog.getAllSetParts),
    getMinifigParts: mit(k)(rebrickableKatalog.getMinifigParts),
    enrichSetParts: mit(k)(teileAnreicherungDienst.enrichSetParts),
    downloadSetImages: mit(k)(teileAnreicherungDienst.downloadSetImages),
    enrichSetMinifigs: mit(k)(teileAnreicherungDienst.enrichSetMinifigs),
    redownloadMissingImages: mit(k)(teileAnreicherungDienst.redownloadMissingImages),
    bildNachlauf: mit(k)(bildNachlauf.bildNachlauf),
    erzeugePdf: mit(k)(pdfErzeugung.erzeugePdf),
    ladeWiderrufsliste: mit(k)(widerrufsliste.ladeWiderrufsliste),
  };
}

export type KatalogDienste = ReturnType<typeof erzeugeKatalog>;
