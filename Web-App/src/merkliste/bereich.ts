/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeMerkliste bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang } from '../infra/bereich';
import * as merklisteDienst from './merkliste';
import * as wantedListeDienst from './wantedListe';
import { zugang, type MerklisteAbhaengigkeiten, type MerklisteKontext } from './kontext';

export type { MerklisteAbhaengigkeiten, MerklisteKontext } from './kontext';

export function erzeugeMerkliste(a: MerklisteAbhaengigkeiten) {
  const k: MerklisteKontext = baueKontext(a, zugang);
  return {
    ...k,
    ...bindeZugang(k, merklisteDienst, [
      'legeMerkpostenAn',
      'loescheMerkposten',
      'verschiebeMerkposten',
      'merkpostenVon',
      'uebernimm',
      'buildMerklisteCsv',
      'preiseBeiderZustaende',
      'importiereMerklisteCsv',
    ]),
    ...bindeZugang(k, wantedListeDienst, ['importiereWantedListe']),
  };
}

export type MerklisteDienste = ReturnType<typeof erzeugeMerkliste>;
