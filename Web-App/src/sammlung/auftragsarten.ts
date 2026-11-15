/** Imports, auf die eine Anfrage wartet, und das Set-CSV der Sets unter derselben Art. */
import { auftragsart, type Anmeldung } from '../auftraege';
import type { SetsDienste } from '../sets';
import { CsvImportNutzlast } from './importAuftraege';
import type { SammlungDienste } from './bereich';

/** Mit `quelle` ein Import, auf den eine Anfrage wartet; ohne das Set-CSV. */
export function sammlungAuftragsarten(d: SammlungDienste, sets: SetsDienste): Anmeldung[] {
  return [
    auftragsart({
      art: 'csv_import',
      nutzlast: CsvImportNutzlast,
      ausfuehren: (n, k, a) => ('quelle' in n ? d.fuehreImportAus(n, k, a) : sets.fuehreCsvImportAus(n, k)),
      aufgegeben: async (n, fehler) => {
        if (!('quelle' in n)) await sets.csvImportAufgegeben(n, fehler);
      },
    }),
  ];
}
