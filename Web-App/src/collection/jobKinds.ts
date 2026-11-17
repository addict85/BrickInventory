import { auftragsart, type Anmeldung } from '../auftraege';
import { CsvImportNutzlast, fuehreImportAus } from './importJobs';
import type { CollectionContext } from './context';

/** With `quelle` an import a request waits on; without it, the set CSV. */
export function collectionJobKinds(k: CollectionContext): Anmeldung[] {
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
