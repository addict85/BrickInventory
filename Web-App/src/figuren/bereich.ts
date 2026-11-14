/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as abfragen from './abfragen';
import * as dienst from './dienst';
import * as manuelleFigurenDienst from './manuelleFiguren';
import { zugang, type FigurenAbhaengigkeiten, type FigurenKontext } from './kontext';

export type { FigurenAbhaengigkeiten, FigurenKontext } from './kontext';

export function erzeugeFiguren(a: FigurenAbhaengigkeiten, einblick?: Einblick<FigurenKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: FigurenKontext) => ({
      getMinifigs: mit(k)(abfragen.getMinifigs),
      getMinifigStats: mit(k)(abfragen.getMinifigStats),
      getManualMinifigs: mit(k)(abfragen.getManualMinifigs),
      teileDerFigur: mit(k)(dienst.teileDerFigur),
      addManualFig: mit(k)(manuelleFigurenDienst.addManualFig),
      updateManualFig: mit(k)(manuelleFigurenDienst.updateManualFig),
      getFigAcquisitions: mit(k)(manuelleFigurenDienst.getFigAcquisitions),
      importiereFigurenCsv: mit(k)(manuelleFigurenDienst.importiereFigurenCsv),
    }),
    einblick,
  );
}

export type FigurenDienste = ReturnType<typeof erzeugeFiguren>;
