/** Die öffentliche Seite des Bereichs: Andere Bereiche importieren nur von hier,
 * damit die Aufteilung der Dateien darunter frei bleibt. */
import { merklisteBereich } from './prozess';
import { dienstePerAufruf } from '../infra/bereich';
export type { Korrektur } from './wantedAufloesung';
export { erzeugeMerkliste } from './bereich';
export type { MerklisteDienste, MerklisteKontext } from './bereich';
export { merklisteBereich } from './prozess';

/** Für Wege ohne eigenen Kontext (HTTP-Seiten, Tests): die Dienste des Prozesses. */
export const {
  buildMerklisteCsv,
  importiereMerklisteCsv,
  importiereWantedListe,
  legeMerkpostenAn,
  loescheMerkposten,
  merkpostenVon,
  preiseBeiderZustaende,
  uebernimm,
  verschiebeMerkposten,
} = dienstePerAufruf(merklisteBereich, [
  'buildMerklisteCsv',
  'importiereMerklisteCsv',
  'importiereWantedListe',
  'legeMerkpostenAn',
  'loescheMerkposten',
  'merkpostenVon',
  'preiseBeiderZustaende',
  'uebernimm',
  'verschiebeMerkposten',
]);
