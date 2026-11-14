/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeKatalog bindet ihn einmal für alle. Wer eine eigene
 * Sperrverbindung hält, ruft das Repository direkt damit auf. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
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
  const k: KatalogKontext = baueKontext({ ...a, cdnDrossel, faecher: new Faecher() }, zugang);
  const fq = () => k.fremdquellen;
  einblick?.(k);
  return {
    ...bindeZugang(k, anleitungLaden, ['anleitungLaden']),
    // Beim Aufruf nachgeschlagen, wie bindeZugang: Der Bau des Katalogs liest die Fremdquellen nicht.
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
    ...bindeZugang(k, partsImport, ['importiereTeile', 'blNummernNachladen']),
    ...bindeZugang(k, rbInventar, ['inventarFuerKandidaten', 'neuestesInventar']),
    ...bindeZugang(k, rebrickableKatalog, ['getSetInfo', 'getAllSetParts', 'getMinifigParts']),
    ...bindeZugang(k, teileAnreicherungDienst, [
      'enrichSetParts',
      'downloadSetImages',
      'enrichSetMinifigs',
      'redownloadMissingImages',
    ]),
    ...bindeZugang(k, bildNachlauf, ['bildNachlauf']),
    ...bindeZugang(k, pdfErzeugung, ['erzeugePdf']),
    ...bindeZugang(k, widerrufsliste, ['ladeWiderrufsliste']),
  };
}

type P<
  N extends
    | 'checkAndIncrementRateLimit'
    | 'getRateLimitStatus'
    | 'kontingentFrei'
    | 'setzeKontingentZurueck'
    | 'getLimitForApi',
> = Parameters<FremdquellenDienste[N]>;

export type KatalogDienste = ReturnType<typeof erzeugeKatalog>;
