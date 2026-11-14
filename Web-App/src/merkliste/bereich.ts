/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as merklisteDienst from './merkliste';
import * as wantedListeDienst from './wantedListe';
import { zugang, type MerklisteAbhaengigkeiten, type MerklisteKontext } from './kontext';

export type { MerklisteAbhaengigkeiten, MerklisteKontext } from './kontext';

export function erzeugeMerkliste(a: MerklisteAbhaengigkeiten, einblick?: Einblick<MerklisteKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: MerklisteKontext) => ({
      legeMerkpostenAn: mit(k)(merklisteDienst.legeMerkpostenAn),
      loescheMerkposten: mit(k)(merklisteDienst.loescheMerkposten),
      verschiebeMerkposten: mit(k)(merklisteDienst.verschiebeMerkposten),
      merkpostenVon: mit(k)(merklisteDienst.merkpostenVon),
      uebernimm: mit(k)(merklisteDienst.uebernimm),
      buildMerklisteCsv: mit(k)(merklisteDienst.buildMerklisteCsv),
      preiseBeiderZustaende: mit(k)(merklisteDienst.preiseBeiderZustaende),
      importiereMerklisteCsv: mit(k)(merklisteDienst.importiereMerklisteCsv),
      importiereWantedListe: mit(k)(wantedListeDienst.importiereWantedListe),
    }),
    einblick,
  );
}

export type MerklisteDienste = ReturnType<typeof erzeugeMerkliste>;
