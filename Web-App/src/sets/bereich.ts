/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import type { SetsAbhaengigkeiten, SetsKontext } from './kontext';
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as erfassen from './erfassen';
import * as setService from './setService';
import * as lesen from './lesen';
import * as loeschen from './loeschen';
import * as setMove from './setMove';
import * as dienst from './dienst';
import * as inhalt from './inhalt';
import * as barcode from './barcode';
import * as preise from './preise';
import * as anleitungen from './anleitungen';
import * as csvImport from './csvImport';
import * as nachErfassung from './nachErfassung';
import * as csvImportLauf from './csvImportLauf';

export function erzeugeSets(a: SetsAbhaengigkeiten, einblick?: Einblick<SetsKontext>) {
  return baueBereich(
    a,
    () => ({}),
    (sk: SetsKontext) => ({
      erfassungBuchen: mit(sk)(erfassen.erfassungBuchen),
      findSetInScope: mit(sk)(erfassen.findSetInScope),
      setErfassen: mit(sk)(erfassen.setErfassen),
      setErgaenzen: mit(sk)(erfassen.setErgaenzen),
      updateSet: mit(sk)(setService.updateSet),
      setsAlsCsv: mit(sk)(setService.setsAlsCsv),
      getSets: mit(sk)(lesen.getSets),
      getSet: mit(sk)(lesen.getSet),
      zustandsAggregat: mit(sk)(lesen.zustandsAggregat),
      mitSetAggregat: mit(sk)(lesen.mitSetAggregat),
      loescheSet: mit(sk)(loeschen.loescheSet),
      loescheSetFuer: mit(sk)(loeschen.loescheSetFuer),
      setZeilenLoeschen: mit(sk)(loeschen.setZeilenLoeschen),
      setVerschieben: mit(sk)(setMove.setVerschieben),
      setErfassungenUmhaengen: mit(sk)(setMove.setErfassungenUmhaengen),
      manuelleErfassungUmhaengen: mit(sk)(setMove.manuelleErfassungUmhaengen),
      setInfo: mit(sk)(inhalt.setInfo),
      setInfoFuerKonto: mit(sk)(inhalt.setInfoFuerKonto),
      teilelisteDesSets: mit(sk)(inhalt.teilelisteDesSets),
      figurenlisteDesSets: mit(sk)(inhalt.figurenlisteDesSets),
      teileDesSetsImportieren: mit(sk)(inhalt.teileDesSetsImportieren),
      teilelisteMitNacharbeit: mit(sk)(inhalt.teilelisteMitNacharbeit),
      setZumBarcode: mit(sk)(barcode.setZumBarcode),
      setPreis: mit(sk)(preise.setPreis),
      waehrungVon: mit(sk)(preise.waehrungVon),
      setAlarmeLesen: mit(sk)(preise.setAlarmeLesen),
      alarmDesSetsSetzen: mit(sk)(preise.alarmDesSetsSetzen),
      alarmDesSetsLoeschen: mit(sk)(preise.alarmDesSetsLoeschen),
      alarmCsvImportStarten: mit(sk)(preise.alarmCsvImportStarten),
      setPreisVerlauf: mit(sk)(preise.setPreisVerlauf),
      anleitungMerken: mit(sk)(anleitungen.anleitungMerken),
      anleitungLoeschen: mit(sk)(anleitungen.anleitungLoeschen),
      anleitungenNeuLaden: mit(sk)(anleitungen.anleitungenNeuLaden),
      setCsvImportStarten: mit(sk)(csvImport.setCsvImportStarten),
      setCsvImportAbbrechen: mit(sk)(csvImport.setCsvImportAbbrechen),
      csvImportStand: mit(sk)(csvImport.csvImportStand),
      csvImportStandFuerStrom: mit(sk)(csvImport.csvImportStandFuerStrom),
      csvImportStandAbonnieren: mit(sk)(csvImport.csvImportStandAbonnieren),
      rebrickableListe: mit(sk)(dienst.rebrickableListe),
      setGehoertKonto: mit(sk)(dienst.setGehoertKonto),
      lagerortDesSetsSetzen: mit(sk)(dienst.lagerortDesSetsSetzen),
      lagerorteMitVorgabe: mit(sk)(dienst.lagerorteMitVorgabe),
      zieheNach: mit(sk)(nachErfassung.zieheNach),
      ladeSetBilder: mit(sk)(nachErfassung.ladeSetBilder),
      fuehreCsvImportAus: mit(sk)(csvImportLauf.fuehreCsvImportAus),
      csvImportAufgegeben: mit(sk)(csvImportLauf.csvImportAufgegeben),
    }),
    einblick,
  );
}

export type SetsDienste = ReturnType<typeof erzeugeSets>;
