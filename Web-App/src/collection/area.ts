/** The area's factory: services as a closure over k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import * as acquisitions from './acquisitions';
import * as deletion from './deletion';
import * as importJobs from './importJobs';
import { collectionJobKinds } from './jobKinds';
import { access, type CollectionDependencies, type CollectionContext } from './context';

export type { CollectionDependencies, CollectionContext } from './context';

export function createCollection(a: CollectionDependencies, inspect?: Inspect<CollectionContext>) {
  return buildArea(
    a,
    access,
    (k: CollectionContext) => ({
      changeAcquisition: mit(k)(acquisitions.changeAcquisition),
      deleteAcquisition: mit(k)(acquisitions.deleteAcquisition),
      setAcquisitionsForSet: mit(k)(acquisitions.setAcquisitionsForSet),
      deletePart: mit(k)(deletion.deletePart),
      deleteMinifig: mit(k)(deletion.deleteMinifig),
      deleteEverythingOwn: mit(k)(deletion.deleteEverythingOwn),
      jobKinds: () => collectionJobKinds(k),
      runImport: mit(k)(importJobs.runImport),
    }),
    inspect,
  );
}

export type CollectionServices = ReturnType<typeof createCollection>;
