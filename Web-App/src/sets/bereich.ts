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
import * as inhalt from './inhalt';
import * as barcode from './barcode';
import * as preise from './preise';
import * as anleitungen from './anleitungen';
import * as csvImport from './csvImport';
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
    ...binde(sk, loeschen, ['loescheSet', 'loescheSetFuer']),
    ...binde(sk, setMove, ['verschiebeSet']),
    ...binde(sk, inhalt, [
      'setInfo',
      'setInfoFuerKonto',
      'teilelisteDesSets',
      'figurenlisteDesSets',
      'teileDesSetsImportieren',
      'teilelisteMitNacharbeit',
    ]),
    ...binde(sk, barcode, ['setZumBarcode']),
    ...binde(sk, preise, ['setPreis']),
    ...binde(sk, anleitungen, ['anleitungMerken', 'anleitungLoeschen', 'anleitungenNeuLaden']),
    ...binde(sk, csvImport, ['setCsvImportStarten']),
    ...binde(sk, dienst, ['rebrickableListe', 'setGehoertKonto', 'setVerschieben']),
    ...binde(sk, nachErfassung, ['zieheNach']),
    ...binde(sk, csvImportLauf, ['fuehreCsvImportAus']),
  };
}

export type SetsDienste = ReturnType<typeof erzeugeSets>;
