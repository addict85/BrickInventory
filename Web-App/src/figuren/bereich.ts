/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as abfragen from './abfragen';
import * as dienst from './dienst';
import * as manuelleFigurenDienst from './manuelleFiguren';
import * as manuelleFigurenRepo from './repository/manuelleFiguren';
import { zugang, type FigurenAbhaengigkeiten, type FigurenKontext } from './kontext';

export type { FigurenAbhaengigkeiten, FigurenKontext } from './kontext';

export function erzeugeFiguren(a: FigurenAbhaengigkeiten, einblick?: Einblick<FigurenKontext>) {
  return baueBereich(
    a,
    zugang,
    (k: FigurenKontext) => ({
      figurenListe: mit(k)(abfragen.getMinifigs),
      figurenKennzahlen: mit(k)(abfragen.getMinifigStats),
      manuelleFiguren: mit(k)(abfragen.getManualMinifigs),
      teileDerFigur: mit(k)(dienst.teileDerFigur),
      legeManuelleFigurAn: mit(k)(manuelleFigurenDienst.addManualFig),
      aendereManuelleFigur: mit(k)(manuelleFigurenDienst.updateManualFig),
      figurErfassungen: mit(k)(manuelleFigurenDienst.getFigAcquisitions),
      importiereFigurenCsv: mit(k)(manuelleFigurenDienst.importiereFigurenCsv),
      // Baustein fremder Löschungen; in deren Transaktion über t.figuren gerufen.
      loescheFigurErfassungen: mit(k.db, manuelleFigurenRepo.loescheFigurErfassungen),
    }),
    einblick,
  );
}

export type FigurenDienste = ReturnType<typeof erzeugeFiguren>;
