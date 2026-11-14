/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { MailDienste } from '../mail';
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
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
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';

export interface FinanzenAbhaengigkeiten {
  konfig: Readonly<Konfig>;
  db: Db;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  nacharbeit: Nacharbeit;
  faecher: Faecher;
  mail: MailDienste;
}

/** Bewertung, Erfassungen, Gewinn und Marktpreise. */
const bestandszugang = (db: Db) => ({
  bewertung: {
    manuelleErfassungen: mit(db)(bewertung.manuelleErfassungen),
    setsZurBewertung: mit(db)(bewertung.setsZurBewertung),
    katalogMerkmale: mit(db)(bewertung.katalogMerkmale),
    manuelleFigurenZurBewertung: mit(db)(bewertung.manuelleFigurenZurBewertung),
    manuelleTeileZurBewertung: mit(db)(bewertung.manuelleTeileZurBewertung),
  },
  erfassungen: {
    ladeSetErfassungen: mit(db)(erfassungen.ladeSetErfassungen),
  },
  gewinnVerlust: {
    setsMitErfassungen: mit(db)(gewinnVerlust.setsMitErfassungen),
    frischeMarktpreise: mit(db)(gewinnVerlust.frischeMarktpreise),
    letzteMarktpreiseAusVerlauf: mit(db)(gewinnVerlust.letzteMarktpreiseAusVerlauf),
  },
  marktpreise: {
    setPreisAusCache: mit(db)(marktpreise.setPreisAusCache),
    teilErfassungsZustand: mit(db)(marktpreise.teilErfassungsZustand),
    figurErfassungsZustand: mit(db)(marktpreise.figurErfassungsZustand),
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
    setsMitKaufsumme: mit(db)(portfolioKurve.setsMitKaufsumme),
  },
});

/** Alarme, Preiszwischenspeicher, Preislauf und Kurse. */
const preiszugang = (db: Db) => ({
  preisalarme: {
    uebertrageAlarm: mit(db)(preisalarme.uebertrageAlarm),
    schreibeAlarm: mit(db)(preisalarme.schreibeAlarm),
    entferneAlarm: mit(db)(preisalarme.entferneAlarm),
    alarmeDesSets: mit(db)(preisalarme.alarmeDesSets),
    alarmeImBlickfeld: mit(db)(preisalarme.alarmeImBlickfeld),
    datenbankJetzt: mit(db)(preisalarme.datenbankJetzt),
    alarmeDesKontos: mit(db)(preisalarme.alarmeDesKontos),
    alleAktivenAlarme: mit(db)(preisalarme.alleAktivenAlarme),
    cachePreisFuerAlarm: mit(db)(preisalarme.cachePreisFuerAlarm),
    setzeAlarmZurueck: mit(db)(preisalarme.setzeAlarmZurueck),
    loeseAlarmAus: mit(db)(preisalarme.loeseAlarmAus),
    setNameAusStamm: mit(db)(preisalarme.setNameAusStamm),
    alarmeFuerExport: mit(db)(preisalarme.alarmeFuerExport),
  },
  preisCache: {
    setZustandsZaehler: mit(db)(preisCache.setZustandsZaehler),
    loescheAlleSetPreise: mit(db)(preisCache.loescheAlleSetPreise),
    setPreisFrisch: mit(db)(preisCache.setPreisFrisch),
    setPreiseFrisch: mit(db)(preisCache.setPreiseFrisch),
    merkeSetPreis: mit(db)(preisCache.merkeSetPreis),
    merkeSetVerlauf: mit(db)(preisCache.merkeSetVerlauf),
    blFarben: mit(db)(preisCache.blFarben),
    teilepreiseFrisch: mit(db)(preisCache.teilepreiseFrisch),
    figurenpreiseFrisch: mit(db)(preisCache.figurenpreiseFrisch),
    teilpreisFrisch: mit(db)(preisCache.teilpreisFrisch),
    figurpreisFrisch: mit(db)(preisCache.figurpreisFrisch),
    merkeTeilpreis: mit(db)(preisCache.merkeTeilpreis),
    merkeTeilVerlauf: mit(db)(preisCache.merkeTeilVerlauf),
    merkeFigurpreis: mit(db)(preisCache.merkeFigurpreis),
    merkeFigurVerlauf: mit(db)(preisCache.merkeFigurVerlauf),
  },
  preisLauf: {
    bestandsPlaetze: mit(db)(preisLauf.bestandsPlaetze),
    merklistenPlaetze: mit(db)(preisLauf.merklistenPlaetze),
    erfassteZustaende: mit(db)(preisLauf.erfassteZustaende),
    gewuenschteZustaende: mit(db)(preisLauf.gewuenschteZustaende),
    schreibeTagesstand: mit(db)(preisLauf.schreibeTagesstand),
    setsMitAlarm: mit(db)(preisLauf.setsMitAlarm),
  },
  preisverlauf: {
    tagespreiseDesSets: mit(db)(preisverlauf.tagespreiseDesSets),
    cachePreiseDesSets: mit(db)(preisverlauf.cachePreiseDesSets),
    ersterKaufDesSets: mit(db)(preisverlauf.ersterKaufDesSets),
    kaufschnittDesSets: mit(db)(preisverlauf.kaufschnittDesSets),
    loescheAltenVerlauf: mit(db)(preisverlauf.loescheAltenVerlauf),
    manualSeries: mit(db)(preisverlauf.manualSeries),
    cachePreiseNachSchluessel: mit(db)(preisverlauf.cachePreiseNachSchluessel),
    kaufschnitteNachSchluessel: mit(db)(preisverlauf.kaufschnitteNachSchluessel),
  },
  setWert: {
    cachePreiseFuerSets: mit(db)(setWert.cachePreiseFuerSets),
    setErfassungenZumWert: mit(db)(setWert.setErfassungenZumWert),
  },
  wechselkurse: {
    schreibeKurse: mit(db)(wechselkurse.schreibeKurse),
    gibtEsKurse: mit(db)(wechselkurse.gibtEsKurse),
  },
});

export const zugang = (db: Db) => ({ ...bestandszugang(db), ...preiszugang(db) });
export type FinanzenKontext = Kontext<FinanzenAbhaengigkeiten, ReturnType<typeof zugang>>;
