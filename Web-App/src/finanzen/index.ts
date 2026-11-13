/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { dienstePerAufruf } from '../infra/bereich';
import { finanzenBereich } from './prozess';

export {
  alarmUebertragen,
  alarmeAusCsv,
  alarmeFuer,
  buildPreisalarmeCsv,
  loescheAlarm,
  setzeAlarm,
} from './preisalarm';
export { alleAlarme, ausgeloesteSeit } from './preisalarm';
export { erzeugeFinanzen } from './bereich';
export type { FinanzenDienste, FinanzenKontext } from './bereich';
export { finanzenBereich } from './prozess';

/** Für Routen: die Preisalarm-Dienste des Prozesses ohne Zugang als ersten Parameter. */
export const preisalarm = dienstePerAufruf(() => finanzenBereich().preisalarm, ['alleAlarme', 'ausgeloesteSeit']);

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  computeMinifigsValuation,
  computePartsValuation,
  computePnl,
  computeSetsValuation,
  farbkarte,
  fetchPrice,
  figMarktpreisMitHerkunft,
  getCurrentFigMarketPrice,
  getCurrentMarketPrice,
  getCurrentPartMarketPrice,
  getPortfolioHistory,
  kaufpreisAusEingabe,
  kursauftrag,
  leerePreisCache,
  manuellerKaufpreis,
  marktpreisMitHerkunft,
  marktpreiseAusCacheFuerFiguren,
  marktpreiseAusCacheFuerTeile,
  planeKursabruf,
  preiseNachladen,
  preisverlaufFigur,
  preisverlaufSet,
  preisverlaufTeil,
  purgeAltePreise,
  refreshPriceForSet,
  resolvePartCondition,
  resolveSetCondition,
  runPriceRefresh,
} = dienstePerAufruf(finanzenBereich, [
  'computeMinifigsValuation',
  'computePartsValuation',
  'computePnl',
  'computeSetsValuation',
  'farbkarte',
  'fetchPrice',
  'figMarktpreisMitHerkunft',
  'getCurrentFigMarketPrice',
  'getCurrentMarketPrice',
  'getCurrentPartMarketPrice',
  'getPortfolioHistory',
  'kaufpreisAusEingabe',
  'kursauftrag',
  'leerePreisCache',
  'manuellerKaufpreis',
  'marktpreisMitHerkunft',
  'marktpreiseAusCacheFuerFiguren',
  'marktpreiseAusCacheFuerTeile',
  'planeKursabruf',
  'preiseNachladen',
  'preisverlaufFigur',
  'preisverlaufSet',
  'preisverlaufTeil',
  'purgeAltePreise',
  'refreshPriceForSet',
  'resolvePartCondition',
  'resolveSetCondition',
  'runPriceRefresh',
]);
