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
      aktuellerMarktpreis: mit(k)(marketPrice.getCurrentMarketPrice),
      marktpreisAusCache: k.preisCache.marktpreisAusCache,
      marktpreisAusVerlauf: k.preisCache.marktpreisAusVerlauf,
      teilZustand: mit(k)(marketPrice.resolvePartCondition),
      marktpreiseAusCacheFuerFiguren: mit(k)(marketPrice.marktpreiseAusCacheFuerFiguren),
      marktpreiseAusCacheFuerTeile: mit(k)(marketPrice.marktpreiseAusCacheFuerTeile),
      figMarktpreisMitHerkunft: mit(k)(marketPrice.figMarktpreisMitHerkunft),
      marktpreisMitHerkunft: mit(k)(marketPrice.marktpreisMitHerkunft),
      aktuellerFigurMarktpreis: mit(k)(marketPrice.getCurrentFigMarketPrice),
      aktuellerTeilMarktpreis: mit(k)(marketPrice.getCurrentPartMarketPrice),
      portfolioVerlauf: mit(k)(portfolioHistory.getPortfolioHistory),
      preisverlaufSet: mit(k)(priceHistory.preisverlaufSet),
      preisverlaufTeil: mit(k)(priceHistory.preisverlaufTeil),
      preisverlaufFigur: mit(k)(priceHistory.preisverlaufFigur),
      loescheAltePreise: mit(k)(priceHistory.purgeAltePreise),
      bewerteSets: mit(k)(bewertungDienst.computeSetsValuation),
      bewerteFiguren: mit(k)(bewertungDienst.computeMinifigsValuation),
      bewerteTeile: mit(k)(bewertungDienst.computePartsValuation),
      gewinnUndVerlust: mit(k)(gewinnVerlustDienst.computePnl),
      setZustand: mit(k)(preise.resolveSetCondition),
      leerePreisCache: mit(k)(preise.leerePreisCache),
      setPreiseImCache: k.preisCache.zaehleSetPreise,
      holePreis: mit(k)(preise.fetchPrice),
      farbkarte: mit(k)(preise.farbkarte),
      preisFuerSetHolen: mit(k)(preisLaufDienst.refreshPriceForSet),
      kaufpreisAusEingabe: mit(k)(preisRegel.kaufpreisAusEingabe),
      manuellerKaufpreis: mit(k)(preisRegel.manuellerKaufpreis),
      planeKursabruf: mit(k)(wechselkurseDienst.planeKursabruf),
      auftragsarten: () => finanzenAuftragsarten(k),
    }),
    einblick,
  );
}

export type FinanzenDienste = ReturnType<typeof erzeugeFinanzen>;
