/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
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
      changeAcquisition: withValue(k)(acquisitions.changeAcquisition),
      deleteAcquisition: withValue(k)(acquisitions.deleteAcquisition),
      setAcquisitionsForSet: withValue(k)(acquisitions.setAcquisitionsForSet),
      deletePart: withValue(k)(deletion.deletePart),
      deleteMinifig: withValue(k)(deletion.deleteMinifig),
      deleteEverythingOwn: withValue(k)(deletion.deleteEverythingOwn),
      jobKinds: () => collectionJobKinds(k),
      runImport: withValue(k)(importJobs.runImport),
    }),
    inspect,
  );
}

export type CollectionServices = ReturnType<typeof createCollection>;
