/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { MailDienste } from '../mail';
import type { Db } from '../../db/database';
import { mit, mitVertrag, type Kontext } from '../infra/bereich';
import type { FinanzenLesevertrag } from './lesevertrag';
import type { Faecher } from '../infra/zwischenspeicher';
import * as bewertung from './repository/bewertung';
import * as erfassungen from './repository/erfassungen';
import * as gewinnVerlust from './repository/gewinnVerlust';
import * as marktpreise from './repository/marktpreise';
import * as portfolioKurve from './repository/portfolioKurve';
import * as preisalarme from './repository/preisalarme';
import * as preisCache from './repository/preisCache';
import * as preisLauf from './repository/preisLauf';
import * as preisverlauf from './repository/preisverlauf';
import * as setWert from './repository/setWert';
import * as wechselkurse from './repository/wechselkurse';
import type { SettingsServices } from '../settings';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { AuftraegeDienste } from '../auftraege';
import type { FremdquellenDienste } from '../fremdquellen';
import type { Uhr } from '../infra/uhr';

export interface FinanzenAbhaengigkeiten {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  einstellungen: SettingsServices;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  fremdquellen: FremdquellenDienste;
  faecher: Faecher;
  mail: MailDienste;
  lesevertrag: FinanzenLesevertrag;
}

/** Bewertung, Erfassungen, Gewinn und Marktpreise. */
const bestandszugang = (db: Db, l: FinanzenLesevertrag) => ({
  bewertung: {
    manuelleErfassungen: mitVertrag(db, l)(bewertung.manuelleErfassungen),
    setsZurBewertung: mitVertrag(db, l)(bewertung.setsZurBewertung),
    katalogMerkmale: mit(db)(bewertung.katalogMerkmale),
    manuelleFigurenZurBewertung: mitVertrag(db, l)(bewertung.manuelleFigurenZurBewertung),
    manuelleTeileZurBewertung: mitVertrag(db, l)(bewertung.manuelleTeileZurBewertung),
  },
  erfassungen: {
    ladeSetErfassungen: mitVertrag(db, l)(erfassungen.ladeSetErfassungen),
  },
  gewinnVerlust: {
    setsMitErfassungen: mitVertrag(db, l)(gewinnVerlust.setsMitErfassungen),
    frischeMarktpreise: mit(db)(gewinnVerlust.frischeMarktpreise),
    letzteMarktpreiseAusVerlauf: mit(db)(gewinnVerlust.letzteMarktpreiseAusVerlauf),
  },
  marktpreise: {
    setPreisAusCache: mit(db)(marktpreise.setPreisAusCache),
    teilErfassungsZustand: mitVertrag(db, l)(marktpreise.teilErfassungsZustand),
    figurErfassungsZustand: mitVertrag(db, l)(marktpreise.figurErfassungsZustand),
    figurenpreiseAusCache: mit(db)(marktpreise.figurenpreiseAusCache),
    teilepreiseAusCache: mit(db)(marktpreise.teilepreiseAusCache),
    geschaetzteFigurenpreise: mit(db)(marktpreise.geschaetzteFigurenpreise),
    geschaetzterFigurenpreis: mit(db)(marktpreise.geschaetzterFigurenpreis),
    merkeGeschaetztenFigurenpreis: mit(db)(marktpreise.merkeGeschaetztenFigurenpreis),
    merkeGeschaetztenFigurenverlauf: mit(db)(marktpreise.merkeGeschaetztenFigurenverlauf),
  },
  portfolioKurve: {
    tageswerteAusVerlauf: mit(db)(portfolioKurve.tageswerteAusVerlauf),
    cachePreiseDerSets: mit(db)(portfolioKurve.cachePreiseDerSets),
    letzteWerteVorBeginn: mit(db)(portfolioKurve.letzteWerteVorBeginn),
    setsMitKaufsumme: mitVertrag(db, l)(portfolioKurve.setsMitKaufsumme),
  },
});

/** Alarme, Preiszwischenspeicher, Preislauf und Kurse. */
const preiszugang = (db: Db, l: FinanzenLesevertrag) => ({
  preisalarme: {
    uebertrageAlarm: mit(db)(preisalarme.uebertrageAlarm),
    schreibeAlarm: mit(db)(preisalarme.schreibeAlarm),
    entferneAlarm: mit(db)(preisalarme.entferneAlarm),
    alarmeDesSets: mitVertrag(db, l)(preisalarme.alarmeDesSets),
    alarmeImBlickfeld: mitVertrag(db, l)(preisalarme.alarmeImBlickfeld),
    datenbankJetzt: mit(db)(preisalarme.datenbankJetzt),
    alarmeDesKontos: mitVertrag(db, l)(preisalarme.alarmeDesKontos),
    alleAktivenAlarme: mit(db)(preisalarme.alleAktivenAlarme),
    cachePreisFuerAlarm: mit(db)(preisalarme.cachePreisFuerAlarm),
    setzeAlarmZurueck: mit(db)(preisalarme.setzeAlarmZurueck),
    loeseAlarmAus: mit(db)(preisalarme.loeseAlarmAus),
    setNameAusStamm: mit(db)(preisalarme.setNameAusStamm),
    alarmeFuerExport: mit(db)(preisalarme.alarmeFuerExport),
  },
  preisCache: {
    setZustandsZaehler: mitVertrag(db, l)(preisCache.setZustandsZaehler),
    loescheAlleSetPreise: mit(db)(preisCache.loescheAlleSetPreise),
    setPreisFrisch: mit(db)(preisCache.setPreisFrisch),
    setPreiseFrisch: mit(db)(preisCache.setPreiseFrisch),
    merkeSetPreis: mit(db)(preisCache.merkeSetPreis),
    merkeSetVerlauf: mit(db)(preisCache.merkeSetVerlauf),
    blFarben: mit(db)(preisCache.blFarben),
    teilepreiseFrisch: mit(db)(preisCache.teilepreiseFrisch),
    marktpreisAusCache: mit(db)(preisCache.marktpreisAusCache),
    marktpreisAusVerlauf: mit(db)(preisCache.marktpreisAusVerlauf),
    figurenpreiseFrisch: mit(db)(preisCache.figurenpreiseFrisch),
    teilpreisFrisch: mit(db)(preisCache.teilpreisFrisch),
    figurpreisFrisch: mit(db)(preisCache.figurpreisFrisch),
    merkeTeilpreis: mit(db)(preisCache.merkeTeilpreis),
    merkeTeilVerlauf: mit(db)(preisCache.merkeTeilVerlauf),
    merkeFigurpreis: mit(db)(preisCache.merkeFigurpreis),
    merkeFigurVerlauf: mit(db)(preisCache.merkeFigurVerlauf),
  },
  preisLauf: {
    bestandsPlaetze: mitVertrag(db, l)(preisLauf.bestandsPlaetze),
    merklistenPlaetze: mitVertrag(db, l)(preisLauf.merklistenPlaetze),
    erfassteZustaende: mitVertrag(db, l)(preisLauf.erfassteZustaende),
    gewuenschteZustaende: mitVertrag(db, l)(preisLauf.gewuenschteZustaende),
    schreibeTagesstand: mit(db)(preisLauf.schreibeTagesstand),
    setsMitAlarm: mit(db)(preisLauf.setsMitAlarm),
  },
  preisverlauf: {
    tagespreiseDesSets: mit(db)(preisverlauf.tagespreiseDesSets),
    cachePreiseDesSets: mit(db)(preisverlauf.cachePreiseDesSets),
    ersterKaufDesSets: mitVertrag(db, l)(preisverlauf.ersterKaufDesSets),
    kaufschnittDesSets: mitVertrag(db, l)(preisverlauf.kaufschnittDesSets),
    loescheAltenVerlauf: mit(db)(preisverlauf.loescheAltenVerlauf),
    manualSeries: mit(db)(preisverlauf.manualSeries),
    cachePreiseNachSchluessel: mit(db)(preisverlauf.cachePreiseNachSchluessel),
    kaufschnitteNachSchluessel: mitVertrag(db, l)(preisverlauf.kaufschnitteNachSchluessel),
  },
  setWert: {
    cachePreiseFuerSets: mit(db)(setWert.cachePreiseFuerSets),
    setErfassungenZumWert: mitVertrag(db, l)(setWert.setErfassungenZumWert),
  },
  wechselkurse: {
    schreibeKurse: mit(db)(wechselkurse.schreibeKurse),
    gibtEsKurse: mit(db)(wechselkurse.gibtEsKurse),
  },
});

export const zugang = (db: Db, l: FinanzenLesevertrag) => ({ ...bestandszugang(db, l), ...preiszugang(db, l) });
export type FinanzenKontext = Kontext<FinanzenAbhaengigkeiten, ReturnType<typeof zugang>>;
