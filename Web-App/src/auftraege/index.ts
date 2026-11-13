/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { auftraegeBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export { AuftragUnterbrochen, AuftragVerschieben, pruefeAbbruch } from './auftraege';
export type { AuftragsKontext, AuftragsLauf, AuftragsZeile } from './auftraege';
export { BRICKSET_HOECHSTENS } from './bricksetAuftrag';
export type { ImportEingabe } from './importAlsAuftrag';
export { buildJobStatus, csvImportBus } from './importAuftrag';
export type { ImportErgebnis } from './importAuftrag';
export type { Nacharbeit } from './nacharbeit';
export type { ImportNutzlast, Nutzlast, SetCsvNutzlast } from './nutzlasten';
export { pdfDateiPfad } from './pdfAuftraege';
export { DAILY_JOBS, naechsteUhrzeit } from './zeitplan';
export { AuftragVerloren } from './auftraege';
export type { AuftragsArt, Fortschritt } from './auftraege';
export { imAuftragsrahmen } from './dienst';
export { NutzlastUngueltig, PREISPOSTEN_HOECHSTENS, WantedKorrekturen, pruefeNutzlast } from './nutzlasten';
export { gueltigeAuftragsKennung, pdfSchluessel } from './pdfAuftraege';
export { belegKennung, meldeProzessAb, meldeProzessAn } from './prozess';
export { oeffentlicherStartZustand } from './startZustand';
export { hatZeitplan } from './zeitplan';
export { erzeugeAuftraege } from './bereich';
export type { AuftraegeDienste, AuftraegeKontext } from './bereich';
export { auftraegeBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  aktuellerStartZustand,
  all,
  anleitungEinreihen,
  auftraegeImUeberblick,
  auftragAbbrechen,
  auftragWiederholen,
  auftragsArtJetzt,
  beendeAuftrag,
  beendePause,
  beiAuftragsStand,
  beiImportStand,
  beiNeuemAuftrag,
  bricksetAusWiedervorlage,
  bricksetFaelligAb,
  bricksetJetzt,
  bricksetListe,
  bricksetTermineVorziehen,
  bricksetVormerken,
  bricksetZahlen,
  cleanOldPdfJobs,
  emitJobStatus,
  erledigt,
  fehlgeschlagen,
  get,
  imNamenDesAuftrags,
  imgDlAdd,
  imgDlPending,
  imgDlReset,
  importAlsAuftrag,
  istAbgebrochen,
  jobGet,
  jobSet,
  jobUpdate,
  leereAuftragsArt,
  liesAuftrag,
  loescheAuftrag,
  meldeAuftrag,
  meldeStartZustand,
  merkePreiseVor,
  pdfAuftragStarten,
  planeAlle,
  planeNaechsten,
  pruefeZugehoerigkeit,
  setzeErgebnis,
  setzeFachfehler,
  setzeFortschritt,
  setzeImportFort,
  starteAuftrag,
  stelleAuftragEin,
  taeglicheUhrzeit,
  verschoben,
  zaehleArt,
  zeitplanGeaendert,
  ziehePlanVor,
} = dienstePerAufruf(auftraegeBereich, [
  'aktuellerStartZustand',
  'all',
  'anleitungEinreihen',
  'auftraegeImUeberblick',
  'auftragAbbrechen',
  'auftragWiederholen',
  'auftragsArtJetzt',
  'beendeAuftrag',
  'beendePause',
  'beiAuftragsStand',
  'beiImportStand',
  'beiNeuemAuftrag',
  'bricksetAusWiedervorlage',
  'bricksetFaelligAb',
  'bricksetJetzt',
  'bricksetListe',
  'bricksetTermineVorziehen',
  'bricksetVormerken',
  'bricksetZahlen',
  'cleanOldPdfJobs',
  'emitJobStatus',
  'erledigt',
  'fehlgeschlagen',
  'get',
  'imNamenDesAuftrags',
  'imgDlAdd',
  'imgDlPending',
  'imgDlReset',
  'importAlsAuftrag',
  'istAbgebrochen',
  'jobGet',
  'jobSet',
  'jobUpdate',
  'leereAuftragsArt',
  'liesAuftrag',
  'loescheAuftrag',
  'meldeAuftrag',
  'meldeStartZustand',
  'merkePreiseVor',
  'pdfAuftragStarten',
  'planeAlle',
  'planeNaechsten',
  'pruefeZugehoerigkeit',
  'setzeErgebnis',
  'setzeFachfehler',
  'setzeFortschritt',
  'setzeImportFort',
  'starteAuftrag',
  'stelleAuftragEin',
  'taeglicheUhrzeit',
  'verschoben',
  'zaehleArt',
  'zeitplanGeaendert',
  'ziehePlanVor',
]);
