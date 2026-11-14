/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeFinanzen bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
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
  const k: FinanzenKontext = baueKontext({ ...a, faecher: new Faecher() }, zugang);
  einblick?.(k);
  return {
    // Die Preisalarme sind Dienste; der Preislauf ruft sie über den Kontext.
    preisalarm: bindeZugang(k, preisalarm, [
      'alarmUebertragen',
      'alarmeAusCsv',
      'alarmeFuer',
      'alleAlarme',
      'ausgeloesteSeit',
      'preisalarmeAlsCsv',
      'loescheAlarm',
      'pruefeSet',
      'setzeAlarm',
    ]),
    ...bindeZugang(k, marketPrice, [
      'getCurrentMarketPrice',
      'resolvePartCondition',
      'marktpreiseAusCacheFuerFiguren',
      'marktpreiseAusCacheFuerTeile',
      'figMarktpreisMitHerkunft',
      'marktpreisMitHerkunft',
      'getCurrentFigMarketPrice',
      'getCurrentPartMarketPrice',
    ]),
    ...bindeZugang(k, portfolioHistory, ['getPortfolioHistory']),
    ...bindeZugang(k, priceHistory, ['preisverlaufSet', 'preisverlaufTeil', 'preisverlaufFigur', 'purgeAltePreise']),
    ...bindeZugang(k, bewertungDienst, ['computeSetsValuation', 'computeMinifigsValuation', 'computePartsValuation']),
    ...bindeZugang(k, gewinnVerlustDienst, ['computePnl']),
    ...bindeZugang(k, preise, ['resolveSetCondition', 'leerePreisCache', 'fetchPrice', 'farbkarte']),
    ...bindeZugang(k, preisLaufDienst, ['runPriceRefresh', 'refreshPriceForSet']),
    ...bindeZugang(k, preisRegel, ['kaufpreisAusEingabe', 'manuellerKaufpreis']),
    ...bindeZugang(k, preiseNachladen, ['preiseNachladen']),
    ...bindeZugang(k, wechselkurseDienst, ['planeKursabruf', 'kursauftrag']),
  };
}

export type FinanzenDienste = ReturnType<typeof erzeugeFinanzen>;
