/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as abfragen from './abfragen';
import * as manuelleTeileDienst from './manuelleTeile';
import * as manuelleTeileRepo from './repository/manuelleTeile';
import * as teilFarbeAendern from './teilFarbeAendern';
import { zugang, type TeileAbhaengigkeiten, type TeileKontext } from './kontext';

export type { TeileAbhaengigkeiten, TeileKontext } from './kontext';

export function erzeugeTeile(a: Omit<TeileAbhaengigkeiten, 'faecher'>, einblick?: Einblick<TeileKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: TeileKontext) => ({
      teileFarben: mit(k)(abfragen.teileFarbenAbfrage),
      teileLesen: mit(k)(abfragen.teileAbfrage),
      teileKategorien: mit(k)(abfragen.teileKategorienAbfrage),
      teileKennzahlen: mit(k)(abfragen.teileKennzahlenLesen),
      manuelleTeileLesen: mit(k)(abfragen.manuelleTeileListe),
      besesseneMengen: mit(k)(abfragen.besesseneMengenAbfrage),
      blFarbkarte: mit(k)(abfragen.blFarbkarteAbfrage),
      legeManuellesTeilAn: mit(k)(manuelleTeileDienst.manuellesTeilAnlegen),
      aendereManuellesTeil: mit(k)(manuelleTeileDienst.manuellesTeilAendern),
      teilErfassungen: mit(k)(manuelleTeileDienst.teilekaeufe),
      importiereTeileCsv: mit(k)(manuelleTeileDienst.importiereTeileCsv),
      // Baustein fremder Löschungen; in deren Transaktion über t.teile gerufen.
      loescheTeilErfassungen: mit(k.db, manuelleTeileRepo.loescheTeilErfassungen),
      aendereTeilFarbe: mit(k)(teilFarbeAendern.aendereTeilFarbe),
    }),
    einblick,
  );
}

export type TeileDienste = ReturnType<typeof erzeugeTeile>;
