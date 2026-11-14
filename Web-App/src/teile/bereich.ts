/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as abfragen from './abfragen';
import * as manuelleTeileDienst from './manuelleTeile';
import * as teilFarbeAendern from './teilFarbeAendern';
import { zugang, type TeileAbhaengigkeiten, type TeileKontext } from './kontext';

export type { TeileAbhaengigkeiten, TeileKontext } from './kontext';

export function erzeugeTeile(a: Omit<TeileAbhaengigkeiten, 'faecher'>, einblick?: Einblick<TeileKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: TeileKontext) => ({
      getPartsColors: mit(k)(abfragen.getPartsColors),
      getParts: mit(k)(abfragen.getParts),
      getPartsCategories: mit(k)(abfragen.getPartsCategories),
      getPartsStats: mit(k)(abfragen.getPartsStats),
      getManualParts: mit(k)(abfragen.getManualParts),
      getOwnedQuantities: mit(k)(abfragen.getOwnedQuantities),
      getBlColorMap: mit(k)(abfragen.getBlColorMap),
      addManualPart: mit(k)(manuelleTeileDienst.addManualPart),
      updateManualPart: mit(k)(manuelleTeileDienst.updateManualPart),
      getPartAcquisitions: mit(k)(manuelleTeileDienst.getPartAcquisitions),
      importiereTeileCsv: mit(k)(manuelleTeileDienst.importiereTeileCsv),
      aendereTeilFarbe: mit(k)(teilFarbeAendern.aendereTeilFarbe),
    }),
    einblick,
  );
}

export type TeileDienste = ReturnType<typeof erzeugeTeile>;
