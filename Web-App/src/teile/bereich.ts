/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeTeile bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang } from '../infra/bereich';
import * as abfragen from './abfragen';
import * as manuelleTeileDienst from './manuelleTeile';
import * as teilFarbeAendern from './teilFarbeAendern';
import { zugang, type TeileAbhaengigkeiten, type TeileKontext } from './kontext';

export type { TeileAbhaengigkeiten, TeileKontext } from './kontext';

export function erzeugeTeile(a: TeileAbhaengigkeiten) {
  const k: TeileKontext = baueKontext(a, zugang);
  return {
    ...k,
    ...bindeZugang(k, abfragen, [
      'getPartsColors',
      'getParts',
      'getPartsCategories',
      'getPartsStats',
      'getManualParts',
      'getOwnedQuantities',
      'getBlColorMap',
    ]),
    ...bindeZugang(k, manuelleTeileDienst, [
      'addManualPart',
      'updateManualPart',
      'getPartAcquisitions',
      'importiereTeileCsv',
    ]),
    ...bindeZugang(k, teilFarbeAendern, ['aendereTeilFarbe']),
  };
}

export type TeileDienste = ReturnType<typeof erzeugeTeile>;
