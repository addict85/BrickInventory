/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as abfragen from './abfragen';
import * as manuelleTeileDienst from './manuelleTeile';
import * as manuelleTeileRepo from './repository/manuelleTeile';
import * as teilFarbeAendern from './teilFarbeAendern';
import { zieheKatalogNach } from './partsSummary';
import { zugang, type TeileAbhaengigkeiten, type TeileKontext } from './kontext';

export type { TeileAbhaengigkeiten, TeileKontext } from './kontext';

export function erzeugeTeile(a: Omit<TeileAbhaengigkeiten, 'faecher'>, einblick?: Einblick<TeileKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: TeileKontext) => ({
      teileFarben: mit(k)(abfragen.getPartsColors),
      teileLesen: mit(k)(abfragen.getParts),
      teileKategorien: mit(k)(abfragen.getPartsCategories),
      teileKennzahlen: mit(k)(abfragen.getPartsStats),
      manuelleTeileLesen: mit(k)(abfragen.getManualParts),
      besesseneMengen: mit(k)(abfragen.getOwnedQuantities),
      blFarbkarte: mit(k)(abfragen.getBlColorMap),
      legeManuellesTeilAn: mit(k)(manuelleTeileDienst.addManualPart),
      aendereManuellesTeil: mit(k)(manuelleTeileDienst.updateManualPart),
      teilErfassungen: mit(k)(manuelleTeileDienst.getPartAcquisitions),
      importiereTeileCsv: mit(k)(manuelleTeileDienst.importiereTeileCsv),
      // Baustein fremder Löschungen; in deren Transaktion über t.teile gerufen.
      loescheTeilErfassungen: mit(k.db, manuelleTeileRepo.loescheTeilErfassungen),
      aendereTeilFarbe: mit(k)(teilFarbeAendern.aendereTeilFarbe),
      zieheKatalogNach: mit(k)(zieheKatalogNach),
    }),
    einblick,
  );
}

export type TeileDienste = ReturnType<typeof erzeugeTeile>;
