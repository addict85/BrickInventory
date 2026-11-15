/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import type { Db } from '../../db/database';
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as marketPrice from './marketPrice';
import * as portfolioHistory from './portfolioHistory';
import * as priceHistory from './priceHistory';
import * as bewertungDienst from './rechnung/bewertung';
import * as gewinnVerlustDienst from './rechnung/gewinnVerlust';
import * as preise from './rechnung/preise';
import * as preisLaufDienst from './preisLauf';
import * as preisRegel from './preisRegel';
import { finanzenAuftragsarten } from './auftragsarten';
import * as wechselkurseDienst from './wechselkurse';
import * as preisalarm from './preisalarm';
import { zugang, type FinanzenAbhaengigkeiten, type FinanzenKontext } from './kontext';

export type { FinanzenAbhaengigkeiten, FinanzenKontext } from './kontext';

export function erzeugeFinanzen(a: Omit<FinanzenAbhaengigkeiten, 'faecher'>, einblick?: Einblick<FinanzenKontext>) {
  // Der Preis-Cache gilt je Währung: Ein Wechsel verlangt einen vollen Preislauf.
  a.einstellungen.beiWaehrungswechsel(() => a.auftraege.ziehePlanVor('preise'));
  return baueBereich(
    { ...a, faecher: new Faecher() },
    (db: Db) => zugang(db, a.lesevertrag),
    (k: FinanzenKontext) => ({
      // Die Preisalarme sind Dienste; der Preislauf ruft sie über den Kontext.
      preisalarm: {
        alarmUebertragen: mit(k)(preisalarm.alarmUebertragen),
        alarmeAusCsv: mit(k)(preisalarm.alarmeAusCsv),
        alarmeFuer: mit(k)(preisalarm.alarmeFuer),
        alleAlarme: mit(k)(preisalarm.alleAlarme),
        ausgeloesteSeit: mit(k)(preisalarm.ausgeloesteSeit),
        preisalarmeAlsCsv: mit(k)(preisalarm.preisalarmeAlsCsv),
        loescheAlarm: mit(k)(preisalarm.loescheAlarm),
        setzeAlarm: mit(k)(preisalarm.setzeAlarm),
      },
      aktuellerMarktpreis: mit(k)(marketPrice.aktuellerMarktpreis),
      marktpreisAusCache: k.preisCache.marktpreisAusCache,
      marktpreisAusVerlauf: k.preisCache.marktpreisAusVerlauf,
      teilZustand: mit(k)(marketPrice.teilZustand),
      marktpreiseAusCacheFuerFiguren: mit(k)(marketPrice.marktpreiseAusCacheFuerFiguren),
      marktpreiseAusCacheFuerTeile: mit(k)(marketPrice.marktpreiseAusCacheFuerTeile),
      figMarktpreisMitHerkunft: mit(k)(marketPrice.figMarktpreisMitHerkunft),
      marktpreisMitHerkunft: mit(k)(marketPrice.marktpreisMitHerkunft),
      aktuellerFigurMarktpreis: mit(k)(marketPrice.aktuellerFigurMarktpreis),
      aktuellerTeilMarktpreis: mit(k)(marketPrice.aktuellerTeilMarktpreis),
      portfolioVerlauf: mit(k)(portfolioHistory.portfolioVerlauf),
      preisverlaufSet: mit(k)(priceHistory.preisverlaufSet),
      preisverlaufTeil: mit(k)(priceHistory.preisverlaufTeil),
      preisverlaufFigur: mit(k)(priceHistory.preisverlaufFigur),
      loescheAltePreise: mit(k)(priceHistory.loescheAltePreise),
      bewerteSets: mit(k)(bewertungDienst.bewerteSets),
      bewerteFiguren: mit(k)(bewertungDienst.bewerteFiguren),
      bewerteTeile: mit(k)(bewertungDienst.bewerteTeile),
      gewinnUndVerlust: mit(k)(gewinnVerlustDienst.gewinnUndVerlust),
      setZustand: mit(k)(preise.setZustand),
      leerePreisCache: mit(k)(preise.leerePreisCache),
      holePreis: mit(k)(preise.holePreis),
      farbkarte: mit(k)(preise.farbkarte),
      preisFuerSetHolen: mit(k)(preisLaufDienst.preisFuerSetHolen),
      kaufpreisAusEingabe: mit(k)(preisRegel.kaufpreisAusEingabe),
      manuellerKaufpreis: mit(k)(preisRegel.manuellerKaufpreis),
      planeKursabruf: mit(k)(wechselkurseDienst.planeKursabruf),
      auftragsarten: () => finanzenAuftragsarten(k),
    }),
    einblick,
  );
}

export type FinanzenDienste = ReturnType<typeof erzeugeFinanzen>;
