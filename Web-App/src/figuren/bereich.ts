/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeFiguren bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import * as abfragen from './abfragen';
import * as dienst from './dienst';
import * as manuelleFigurenDienst from './manuelleFiguren';
import { zugang, type FigurenAbhaengigkeiten, type FigurenKontext } from './kontext';

export type { FigurenAbhaengigkeiten, FigurenKontext } from './kontext';

export function erzeugeFiguren(a: FigurenAbhaengigkeiten, einblick?: Einblick<FigurenKontext>) {
  const k: FigurenKontext = baueKontext(a, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, abfragen, ['getMinifigs', 'getMinifigStats', 'getManualMinifigs']),
    ...bindeZugang(k, dienst, ['teileDerFigur']),
    ...bindeZugang(k, manuelleFigurenDienst, [
      'addManualFig',
      'updateManualFig',
      'getFigAcquisitions',
      'importiereFigurenCsv',
    ]),
  };
}

export type FigurenDienste = ReturnType<typeof erzeugeFiguren>;
