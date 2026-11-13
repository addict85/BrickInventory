/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { verwaltungBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export { istHeikel } from './datenexport';
export { bildProbe } from './diagnose';
export { bricksetListe, quellePruefen } from './dienst';
export { auftragAbbrechen, auftragWiederholen, auftragsArtJetzt } from './hintergrund';
export { NACHLAEUFE } from './startNachlaeufe';
export type { Nachlauf } from './startNachlaeufe';
export { hatGlobaleWerte } from './einstellungenSpeichern';
export { erzeugeVerwaltung } from './bereich';
export type { VerwaltungDienste, VerwaltungKontext } from './bereich';
export { verwaltungBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  anleitungenNeuEinreihen,
  aufraeumen,
  aufraeumenTaeglich,
  auftragsArtLeeren,
  auftragsUebersicht,
  bildDiagnose,
  bildFehlanzeigenVergessen,
  bricksetEntfernen,
  bricksetLimitGesetzt,
  bricksetWiederholen,
  cacheStatistik,
  cachesLeeren,
  datenZip,
  datenbankBereit,
  einstellungenSpeichern,
  fehlendeBilderNachladen,
  gesundheitsBericht,
  jobUebersicht,
  jobZeitplanSetzen,
  katalogAbgleichJetzt,
  katalogBilderEinreihen,
  konfigExport,
  konfigImport,
  nachlauf,
  preisJobJetzt,
  preisJobStand,
  preisProbe,
  serverProtokollSeit,
} = dienstePerAufruf(verwaltungBereich, [
  'anleitungenNeuEinreihen',
  'aufraeumen',
  'aufraeumenTaeglich',
  'auftragsArtLeeren',
  'auftragsUebersicht',
  'bildDiagnose',
  'bildFehlanzeigenVergessen',
  'bricksetEntfernen',
  'bricksetLimitGesetzt',
  'bricksetWiederholen',
  'cacheStatistik',
  'cachesLeeren',
  'datenZip',
  'datenbankBereit',
  'einstellungenSpeichern',
  'fehlendeBilderNachladen',
  'gesundheitsBericht',
  'jobUebersicht',
  'jobZeitplanSetzen',
  'katalogAbgleichJetzt',
  'katalogBilderEinreihen',
  'konfigExport',
  'konfigImport',
  'nachlauf',
  'preisJobJetzt',
  'preisJobStand',
  'preisProbe',
  'serverProtokollSeit',
]);
