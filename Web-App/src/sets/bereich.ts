/** Die Fabrik des Bereichs: Wer Datenbank oder Nacharbeit braucht, bekommt sie als
 * ersten Parameter (SetsKontext); erzeugeSets bindet ihn einmal für alle. So
 * greift kein Dienst auf den Zugang des Prozesses zu. Gesucht wird beim Aufruf,
 * damit ein Test eine Funktion des Moduls ersetzen kann. */
import type { SetsKontext } from './kontext';
import * as erfassen from './erfassen';
import * as setService from './setService';
import * as lesen from './lesen';
import * as loeschen from './loeschen';
import * as setMove from './setMove';
import * as dienst from './dienst';
import * as nachErfassung from './nachErfassung';
import * as csvImportLauf from './csvImportLauf';

type Gebunden<F> = F extends (sk: SetsKontext, ...a: infer A) => infer R ? (...a: A) => R : never;

function binde<M, N extends keyof M & string>(
  sk: SetsKontext,
  modul: M,
  namen: readonly N[],
): { [K in N]: Gebunden<M[K]> } {
  const gebunden: Record<string, unknown> = {};
  for (const name of namen)
    gebunden[name] = (...a: unknown[]) => (modul[name] as (sk: SetsKontext, ...x: unknown[]) => unknown)(sk, ...a);
  return gebunden as { [K in N]: Gebunden<M[K]> };
}

export function erzeugeSets(sk: SetsKontext) {
  return {
    ...binde(sk, erfassen, [
      'recordAcquisition',
      'findSetInScope',
      'setErfassen',
      'setErgaenzen',
      'addSet',
      'addSetWithDate',
    ]),
    ...binde(sk, setService, ['updateSet', 'buildSetsCsv']),
    ...binde(sk, lesen, ['getSets', 'getSet', 'getSetConditionAggregate', 'withSetAggregate']),
    ...binde(sk, loeschen, ['deleteSet', 'loescheSetFuer']),
    ...binde(sk, setMove, ['verschiebeSet']),
    ...binde(sk, dienst, [
      'setInfo',
      'setInfoFuerKonto',
      'setZumBarcode',
      'setZumBarcodeFuerKonto',
      'teilelisteDesSets',
      'figurenlisteDesSets',
      'setPreis',
      'rebrickableListe',
      'setGehoertKonto',
      'anleitungMerken',
      'anleitungLoeschen',
      'setCsvImportStarten',
      'teileDesSetsImportieren',
      'anleitungenNeuLaden',
      'teilelisteFuerKonto',
      'setVerschieben',
      'waehrungVon',
      'lagerortDesSetsSetzen',
      'lagerorteMitVorgabe',
      'setAlarmeLesen',
      'alarmDesSetsSetzen',
      'alarmDesSetsLoeschen',
      'alarmCsvImportStarten',
      'setPreisVerlauf',
    ]),
    ...binde(sk, nachErfassung, ['zieheNach']),
    ...binde(sk, csvImportLauf, ['fuehreCsvImportAus']),
  };
}

export type SetsDienste = ReturnType<typeof erzeugeSets>;
