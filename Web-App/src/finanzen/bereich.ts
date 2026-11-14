/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
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
import * as preiseNachladen from './preiseNachladen';
import * as wechselkurseDienst from './wechselkurse';
import * as preisalarm from './preisalarm';
import { zugang, type FinanzenAbhaengigkeiten, type FinanzenKontext } from './kontext';

export type { FinanzenAbhaengigkeiten, FinanzenKontext } from './kontext';

export function erzeugeFinanzen(a: Omit<FinanzenAbhaengigkeiten, 'faecher'>, einblick?: Einblick<FinanzenKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: FinanzenKontext) => ({
      // Die Preisalarme sind Dienste; der Preislauf ruft sie über den Kontext.
      preisalarm: {
        alarmUebertragen: mit(k)(preisalarm.alarmUebertragen),
        alarmeAusCsv: mit(k)(preisalarm.alarmeAusCsv),
        alarmeFuer: mit(k)(preisalarm.alarmeFuer),
        alleAlarme: mit(k)(preisalarm.alleAlarme),
        ausgeloesteSeit: mit(k)(preisalarm.ausgeloesteSeit),
        buildPreisalarmeCsv: mit(k)(preisalarm.buildPreisalarmeCsv),
        loescheAlarm: mit(k)(preisalarm.loescheAlarm),
        pruefeSet: mit(k)(preisalarm.pruefeSet),
        setzeAlarm: mit(k)(preisalarm.setzeAlarm),
      },
      getCurrentMarketPrice: mit(k)(marketPrice.getCurrentMarketPrice),
      resolvePartCondition: mit(k)(marketPrice.resolvePartCondition),
      marktpreiseAusCacheFuerFiguren: mit(k)(marketPrice.marktpreiseAusCacheFuerFiguren),
      marktpreiseAusCacheFuerTeile: mit(k)(marketPrice.marktpreiseAusCacheFuerTeile),
      figMarktpreisMitHerkunft: mit(k)(marketPrice.figMarktpreisMitHerkunft),
      marktpreisMitHerkunft: mit(k)(marketPrice.marktpreisMitHerkunft),
      getCurrentFigMarketPrice: mit(k)(marketPrice.getCurrentFigMarketPrice),
      getCurrentPartMarketPrice: mit(k)(marketPrice.getCurrentPartMarketPrice),
      getPortfolioHistory: mit(k)(portfolioHistory.getPortfolioHistory),
      preisverlaufSet: mit(k)(priceHistory.preisverlaufSet),
      preisverlaufTeil: mit(k)(priceHistory.preisverlaufTeil),
      preisverlaufFigur: mit(k)(priceHistory.preisverlaufFigur),
      purgeAltePreise: mit(k)(priceHistory.purgeAltePreise),
      computeSetsValuation: mit(k)(bewertungDienst.computeSetsValuation),
      computeMinifigsValuation: mit(k)(bewertungDienst.computeMinifigsValuation),
      computePartsValuation: mit(k)(bewertungDienst.computePartsValuation),
      computePnl: mit(k)(gewinnVerlustDienst.computePnl),
      resolveSetCondition: mit(k)(preise.resolveSetCondition),
      leerePreisCache: mit(k)(preise.leerePreisCache),
      fetchPrice: mit(k)(preise.fetchPrice),
      farbkarte: mit(k)(preise.farbkarte),
      runPriceRefresh: mit(k)(preisLaufDienst.runPriceRefresh),
      refreshPriceForSet: mit(k)(preisLaufDienst.refreshPriceForSet),
      kaufpreisAusEingabe: mit(k)(preisRegel.kaufpreisAusEingabe),
      manuellerKaufpreis: mit(k)(preisRegel.manuellerKaufpreis),
      preiseNachladen: mit(k)(preiseNachladen.preiseNachladen),
      planeKursabruf: mit(k)(wechselkurseDienst.planeKursabruf),
      kursauftrag: mit(k)(wechselkurseDienst.kursauftrag),
    }),
    einblick,
  );
}

export type FinanzenDienste = ReturnType<typeof erzeugeFinanzen>;
