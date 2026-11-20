import { auftragsart, type Anmeldung } from '../jobQueue';
import { CsvImportPayload, runImportFrom } from './importJobs';
import type { CollectionContext } from './context';

/** With `quelle` an import a request waits on; without it, the set CSV. */
export function collectionJobKinds(k: CollectionContext): Anmeldung[] {
  return [
    auftragsart({
      art: 'csv_import',
      nutzlast: CsvImportPayload,
      discardPayload: true,
      ausfuehren: (n, l, a) => ('quelle' in n ? runImportFrom(k, n, l, a) : k.sets.runCsvImportFrom(n, l)),
      aufgegeben: async (n, fehler) => {
        if (!('quelle' in n)) await k.sets.csvImportGivenUp(n, fehler);
      },
    }),
  ];
}
