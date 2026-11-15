import { auftragsart, type Anmeldung } from '../auftraege';
import { CsvImportNutzlast, fuehreImportAus } from './importAuftraege';
import type { SammlungKontext } from './kontext';

/** Mit `quelle` ein Import, auf den eine Anfrage wartet; ohne das Set-CSV. */
export function sammlungAuftragsarten(k: SammlungKontext): Anmeldung[] {
  return [
    auftragsart({
      art: 'csv_import',
      nutzlast: CsvImportNutzlast,
      nutzlastVerwerfen: true,
      ausfuehren: (n, l, a) => ('quelle' in n ? fuehreImportAus(k, n, l, a) : k.sets.fuehreCsvImportAus(n, l)),
      aufgegeben: async (n, fehler) => {
        if (!('quelle' in n)) await k.sets.csvImportAufgegeben(n, fehler);
      },
    }),
  ];
}
