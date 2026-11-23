/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
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
      changeAcquisition: bound(k)(acquisitions.changeAcquisition),
      deleteAcquisition: bound(k)(acquisitions.deleteAcquisition),
      setAcquisitionsForSet: bound(k)(acquisitions.setAcquisitionsForSet),
      deletePart: bound(k)(deletion.deletePart),
      deleteMinifig: bound(k)(deletion.deleteMinifig),
      deleteEverythingOwn: bound(k)(deletion.deleteEverythingOwn),
      jobKinds: () => collectionJobKinds(k),
      runImport: bound(k)(importJobs.runImport),
    }),
    inspect,
  );
}

export type CollectionServices = ReturnType<typeof createCollection>;
