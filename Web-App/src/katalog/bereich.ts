/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). Wer eine eigene Sperrverbindung hält, ruft das Repository direkt damit auf. */
import type { Db } from '../../db/database';
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as bildlageDienst from './bildlage';
import * as blZuordnungDienst from './blZuordnung';
import * as bricklinkLink from './bricklinkLink';
import * as bricklinkPreise from './bricklinkPreise';
import * as bricksetNachlauf from './bricksetNachlauf';
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
import { ConcurrentRateLimiter } from '../fremdquellen';
import * as pdfAuftraege from './pdf/pdfAuftraege';
import * as anleitungsAuftrag from './anleitungsAuftrag';
import * as setStamm from './setStamm';
import { katalogAuftragsarten } from './auftragsarten';
import { zugang, type KatalogAbhaengigkeiten, type KatalogKontext } from './kontext';

export type { KatalogAbhaengigkeiten, KatalogKontext } from './kontext';

export function erzeugeKatalog(
  a: Omit<KatalogAbhaengigkeiten, 'faecher' | 'cdnDrossel'>,
  einblick?: Einblick<KatalogKontext>,
) {
  const cdnDrossel = new ConcurrentRateLimiter(2, 1000);
  const d = baueBereich(
    { ...a, cdnDrossel, faecher: new Faecher() },
    (db: Db) => zugang(db, a.lesevertrag),
    katalogDienste,
    einblick,
  );
  return d;
}

function bildDienste(k: KatalogKontext) {
  return {
    fuelleAusBrickset: mit(k)(bildlageDienst.fuelleAusBrickset),
    anleitungenNachtragen: mit(k)(bildlageDienst.anleitungenNachtragen),
    setBilderNachladen: mit(k)(bildlageDienst.setBilderNachladen),
    vorschaubilderNachtragen: mit(k)(bildlageDienst.vorschaubilderNachtragen),
    setBildLokalEintragen: mit(k)(bildlageDienst.setBildLokalEintragen),
  };
}

function katalogDienste(k: KatalogKontext) {
  return {
    ...bildDienste(k),
    merkeBlNummer: mit(k)(blZuordnungDienst.merkeBlNummer),
    merkeEigeneBlNummer: mit(k)(blZuordnungDienst.merkeEigeneBlNummer),
    blNummerVon: mit(k)(blZuordnungDienst.blNummerVon),
    blAbrufNummer: mit(k)(blZuordnungDienst.blAbrufNummer),
    blAbrufNummern: mit(k)(blZuordnungDienst.blAbrufNummern),
    merkeBlFarbnummer: mit(k)(blZuordnungDienst.merkeBlFarbnummer),
    blLinksAufloesen: mit(k)(bricklinkLink.vieleAufloesen),
    blLinkAufloesen: mit(k)(bricklinkLink.einesAufloesen),
    setBekanntImKatalog: mit(k)(bricklinkPreise.setBekanntImKatalog),
    katalogEintrag: mit(k)(bricklinkPreise.katalogEintrag),
    leereTeilmengenCache: mit(k)(bricklinkPreise.teilmengenCacheLeeren),
    leereKatalogCache: mit(k)(bricklinkPreise.katalogCacheLeeren),
    cacheStand: mit(k)(bricklinkPreise.getCacheStats),
    preisfuehrer: mit(k)(bricklinkPreise.preisfuehrerAbfrage),
    bricksetListe: mit(k)(bricksetNachlauf.bricksetListe),
    anleitungEinreihen: mit(k)(anleitungsAuftrag.anleitungEinreihen),
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
    ladeSetAnleitungen: mit(k)(instructions.setAnleitungenLaden),
    gleicheFehlendeAb: mit(k)(katalogAbgleich.syncAllMissing),
    teilfarbenbilderNachtragen: mit(k)(katalogAbgleich.teilfarbenbilderNachtragen),
    merkeTeil: mit(k)(katalogPflege.merkeTeil),
    merkeTeilFarbe: mit(k)(katalogPflege.merkeTeilFarbe),
    merkeFigur: mit(k)(katalogPflege.merkeFigur),
    merkeSetFiguren: mit(k)(katalogPflege.merkeSetFiguren),
    katalogTeil: mit(k)(katalogPflege.katalogTeil),
    katalogFigur: mit(k)(katalogPflege.katalogFigur),
    figurenAusKatalog: mit(k)(minifigsImport.figurenAusKatalog),
    setFigurenLaden: mit(k)(minifigsImport.setFigurenLaden),
    setFigurenMerken: mit(k)(minifigsImport.setFigurenMerken),
    setTeileLaden: mit(k)(partsImport.setTeileLaden),
    setTeileMerken: mit(k)(partsImport.setTeileMerken),
    setTeilBilderEinreihen: mit(k)(partsImport.setTeilBilderEinreihen),
    blNummernNachladen: mit(k)(partsImport.blNummernNachladen),
    inventarFuerKandidaten: mit(k)(rbInventar.inventarFuerKandidaten),
    neuestesInventar: mit(k)(rbInventar.neuestesInventar),
    setInfo: mit(k)(rebrickableKatalog.setAngaben),
    alleSetTeile: mit(k)(rebrickableKatalog.alleTeileDesSets),
    figurTeile: mit(k)(rebrickableKatalog.figurTeileAbfrage),
    reichereSetTeileAn: mit(k)(teileAnreicherungDienst.enrichSetParts),
    ladeSetBilder: mit(k)(teileAnreicherungDienst.downloadSetImages),
    reichereSetFigurenAn: mit(k)(teileAnreicherungDienst.enrichSetMinifigs),
    /** PDF-Aufträge eines Kontos: anstossen, verfolgen, verwerfen; das Aufräumen über alle. */
    pdf: {
      starten: mit(k)(pdfAuftraege.pdfAuftragStarten),
      lies: mit(k)(pdfAuftraege.liesAuftrag),
      fertigeDatei: mit(k)(pdfAuftraege.fertigeDatei),
      loesche: mit(k)(pdfAuftraege.loescheAuftrag),
      raeumeAuf: mit(k)(pdfAuftraege.cleanOldPdfJobs),
    },
    katalogStand: mit(k.db, setStamm.katalogStand),
    merkeKatalogPlatzhalter: mit(k.db, setStamm.merkeKatalogPlatzhalter),
    merkeSetKatalog: mit(k.db, setStamm.merkeSetKatalog),
    auftragsarten: (importProzess: string) => katalogAuftragsarten(k, importProzess),
  };
}

export type KatalogDienste = ReturnType<typeof erzeugeKatalog>;
