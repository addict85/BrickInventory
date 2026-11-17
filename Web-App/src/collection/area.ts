/** The area's factory: services as a closure over k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as acquisitions from './acquisitions';
import * as deletion from './deletion';
import * as importJobs from './importJobs';
import { collectionJobKinds } from './jobKinds';
import { access, type CollectionDependencies, type CollectionContext } from './context';

export type { CollectionDependencies, CollectionContext } from './context';

export function createCollection(a: CollectionDependencies, einblick?: Einblick<CollectionContext>) {
  return baueBereich(
    a,
    access,
    (k: CollectionContext) => ({
      changeAcquisition: mit(k)(acquisitions.changeAcquisition),
      deleteAcquisition: mit(k)(acquisitions.deleteAcquisition),
      setAcquisitionsForSet: mit(k)(acquisitions.setAcquisitionsForSet),
      loescheTeil: mit(k)(deletion.loescheTeil),
      loescheFigur: mit(k)(deletion.loescheFigur),
      loescheAllesEigene: mit(k)(deletion.loescheAllesEigene),
      jobKinds: () => collectionJobKinds(k),
      runImport: mit(k)(importJobs.runImport),
    }),
    einblick,
  );
}

export type CollectionServices = ReturnType<typeof createCollection>;
