import { jobKind, type Login } from '../jobQueue';
import { CsvImportPayload, runImportFrom } from './importJobs';
import type { CollectionContext } from './context';

/** With `quelle` an import a request waits on; without it, the set CSV. */
export function collectionJobKinds(k: CollectionContext): Login[] {
  return [
    jobKind({
      art: 'csv_import',
      nutzlast: CsvImportPayload,
      discardPayload: true,
      ausfuehren: (n, l, a) => ('quelle' in n ? runImportFrom(k, n, l, a) : k.sets.runCsvImportFrom(n, l)),
      givenUp: async (n, error) => {
        if (!('quelle' in n)) await k.sets.csvImportGivenUp(n, error);
      },
    }),
  ];
}
