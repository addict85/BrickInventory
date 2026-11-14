/** Die Fabrik des Bereichs: Wer Datenbank oder Nacharbeit braucht, bekommt sie als
 * ersten Parameter (SetsKontext); erzeugeSets bindet ihn einmal für alle. So
 * greift kein Dienst auf den Zugang des Prozesses zu. Gesucht wird beim Aufruf,
 * damit ein Test eine Funktion des Moduls ersetzen kann. */
import type { SetsAbhaengigkeiten, SetsKontext } from './kontext';
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
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
  const sk: SetsKontext = baueKontext(a, () => ({}));
  einblick?.(sk);
  return {
    ...bindeZugang(sk, erfassen, ['recordAcquisition', 'findSetInScope', 'setErfassen', 'setErgaenzen']),
    ...bindeZugang(sk, setService, ['updateSet', 'buildSetsCsv']),
    ...bindeZugang(sk, lesen, ['getSets', 'getSet', 'getSetConditionAggregate', 'withSetAggregate']),
    ...bindeZugang(sk, loeschen, ['loescheSet', 'loescheSetFuer', 'deleteSetRows']),
    ...bindeZugang(sk, setMove, ['verschiebeSet', 'moveSetBetweenAccounts', 'moveManualAcquisition']),
    ...bindeZugang(sk, inhalt, [
      'setInfo',
      'setInfoFuerKonto',
      'teilelisteDesSets',
      'figurenlisteDesSets',
      'teileDesSetsImportieren',
      'teilelisteMitNacharbeit',
    ]),
    ...bindeZugang(sk, barcode, ['setZumBarcode']),
    ...bindeZugang(sk, preise, [
      'setPreis',
      'waehrungVon',
      'setAlarmeLesen',
      'alarmDesSetsSetzen',
      'alarmDesSetsLoeschen',
      'alarmCsvImportStarten',
      'setPreisVerlauf',
    ]),
    ...bindeZugang(sk, anleitungen, ['anleitungMerken', 'anleitungLoeschen', 'anleitungenNeuLaden']),
    ...bindeZugang(sk, csvImport, [
      'setCsvImportStarten',
      'setCsvImportAbbrechen',
      'csvImportStand',
      'csvImportStandFuerStrom',
      'csvImportStandAbonnieren',
    ]),
    ...bindeZugang(sk, dienst, [
      'rebrickableListe',
      'setGehoertKonto',
      'setVerschieben',
      'lagerortDesSetsSetzen',
      'lagerorteMitVorgabe',
    ]),
    ...bindeZugang(sk, nachErfassung, ['zieheNach', 'ladeSetBilder']),
    ...bindeZugang(sk, csvImportLauf, ['fuehreCsvImportAus', 'csvImportAufgegeben']),
  };
}

export type SetsDienste = ReturnType<typeof erzeugeSets>;
