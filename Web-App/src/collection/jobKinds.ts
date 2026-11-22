import { jobKind, type Login } from '../jobQueue';
import { CsvImportPayload, runImportFrom } from './importJobs';
import type { CollectionContext } from './context';

/** With `quelle` an import a request waits on; without it, the set CSV. */
export function collectionJobKinds(k: CollectionContext): Login[] {
  return [
    jobKind({
      kind: 'csv_import',
      payload: CsvImportPayload,
      discardPayload: true,
      run: (n, l, a) => ('source' in n ? runImportFrom(k, n, l, a) : k.sets.runCsvImportFrom(n, l)),
      givenUp: async (n, error) => {
        if (!('source' in n)) await k.sets.csvImportGivenUp(n, error);
      },
    }),
  ];
}
