/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeKatalog bindet ihn einmal für alle. Wer eine eigene
 * Sperrverbindung hält, ruft das Repository direkt damit auf. */
import { baueKontext, bindeZugang } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anleitungLaden from './anleitungLaden';
import * as apiKontingentDienst from './apiKontingent';
import * as bildlageDienst from './bildlage';
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
import * as bildbedarfDienst from './bilder/bildbedarf';
import * as bildbedarfLauf from './bilder/bildbedarfLauf';
import * as imageMisses from './bilder/imageMisses';
import * as rateLimiter from './rateLimiter';
import * as bildNachlauf from './bildNachlauf';
import * as pdfErzeugung from './pdf/pdfErzeugung';
import * as bildBlickfeldDienst from './bilder/bildBlickfeld';
import * as bildNachschlagen from './bilder/bildNachschlagen';
import * as proxyThumbs from './bilder/proxyThumbs';
import * as imgCacheServe from './bilder/imgCacheServe';
import { downloadSetImage } from './bilder/setImages';
import { generateThumb } from './bilder/thumbs';
import { zugang, type Bildwerk, type KatalogAbhaengigkeiten, type KatalogKontext } from './kontext';

export type { Bildwerk, KatalogAbhaengigkeiten, KatalogKontext } from './kontext';

/** Ohne `bildwerk` das echte; ein Test gibt seines mit (startup/verdrahtung.ts baueDienste). */
export function erzeugeKatalog(
  a: Omit<KatalogAbhaengigkeiten, 'faecher' | 'bildwerk'> & { bildwerk?: Bildwerk | undefined },
) {
  const bildwerk = a.bildwerk ?? { setBildLaden: downloadSetImage, vorschauErzeugen: generateThumb };
  const k: KatalogKontext = baueKontext({ ...a, bildwerk, faecher: new Faecher() }, zugang);
  return {
    ...k,
    ...bindeZugang(k, anleitungLaden, ['anleitungLaden']),
    ...bindeZugang(k, apiKontingentDienst, [
      'checkAndIncrementRateLimit',
      'getRateLimitStatus',
      'kontingentFrei',
      'setzeKontingentZurueck',
      'getLimitForApi',
    ]),
    ...bindeZugang(k, bildlageDienst, [
      'fuelleAusBrickset',
      'anleitungenNachtragen',
      'setBilderNachladen',
      'vorschaubilderNachtragen',
      'setBildLokalEintragen',
    ]),
    ...bindeZugang(k, blZuordnungDienst, [
      'merkeBlNummer',
      'merkeEigeneBlNummer',
      'blNummerVon',
      'blAbrufNummer',
      'blAbrufNummern',
      'merkeBlFarbnummer',
    ]),
    ...bindeZugang(k, bricklinkLink, ['resolveMany', 'resolveOne']),
    ...bindeZugang(k, bricklinkPreise, [
      'setBekanntImKatalog',
      'katalogEintrag',
      'clearSubsetsCache',
      'clearCatalogCache',
      'getCacheStats',
      'getPriceGuide',
    ]),
    ...bindeZugang(k, bricksetNachlauf, ['bricksetNachlauf']),
    ...bindeZugang(k, csvAbgleich, ['csvAbgleich']),
    ...bindeZugang(k, dienst, ['katalogMeta', 'jahrVerteilung', 'katalogSeite', 'katalogGeladen', 'katalogSet']),
    ...bindeZugang(k, farben, ['farbliste']),
    ...bindeZugang(k, instructions, [
      'anzahlAnleitungen',
      'anleitungenZuSet',
      'anleitungNeuLadenErlaubt',
      'loescheAnleitungen',
      'downloadSetInstructions',
    ]),
    ...bindeZugang(k, katalogAbgleich, ['syncAllMissing', 'teilfarbenbilderNachtragen']),
    ...bindeZugang(k, katalogPflege, [
      'merkeTeil',
      'merkeTeilFarbe',
      'merkeFigur',
      'merkeSetFiguren',
      'katalogTeil',
      'katalogFigur',
    ]),
    ...bindeZugang(k, minifigsImport, ['figurenAusKatalog', 'importiereFiguren']),
    ...bindeZugang(k, partsImport, ['importiereTeile', 'fetchMissingBlIds', 'importPartsForSet']),
    ...bindeZugang(k, rbInventar, ['inventarFuerKandidaten', 'neuestesInventar']),
    ...bindeZugang(k, rebrickableKatalog, ['getSetInfo', 'getAllSetParts', 'getMinifigParts']),
    ...bindeZugang(k, teileAnreicherungDienst, [
      'enrichSetParts',
      'downloadSetImages',
      'enrichSetMinifigs',
      'redownloadMissingImages',
    ]),
    ...bindeZugang(k, bildbedarfDienst, [
      'loescheVerfallene',
      'katalogBilderVormerken',
      'offenerBildbedarf',
      'leereBildbedarf',
      'bildbedarfAnstossen',
    ]),
    ...bindeZugang(k, bildbedarfLauf, ['bildbedarfAbarbeiten']),
    ...bindeZugang(k, imageMisses, ['vergissFehlend']),
    ...bindeZugang(k, rateLimiter, ['rebrickableDailyStatus']),
    ...bindeZugang(k, bildNachlauf, ['bildNachlauf']),
    ...bindeZugang(k, pdfErzeugung, ['erzeugePdf']),
    ...bindeZugang(k, bildBlickfeldDienst, ['anleitungFreigegeben', 'setNummerImBlickfeld']),
    ...bindeZugang(k, bildNachschlagen, ['cdnFuerFehlendesBild']),
    ...bindeZugang(k, proxyThumbs, ['queueThumb']),
    ...bindeZugang(k, imgCacheServe, ['cacheTreffer']),
  };
}

export type KatalogDienste = ReturnType<typeof erzeugeKatalog>;
