/** What the image services receive: access, compartments, jobs, household, external sources and the
 * image works. Separate from area.ts so that a service knows its type without an import cycle. */
import type { AppConfig } from '../infra/config';
import { bound, withContract, type Context } from '../infra/area';
import type { ImagesReadContract } from './readContract';
import type { Compartments } from '../infra/cache';
import type { Db } from '../../db/database';
import type { JobsServices } from '../jobQueue';
import type { ForeignSourcesServices } from '../externalSources';
import type { HouseholdServices } from '../household';
import * as imageScope from './repository/imageScope';
import * as imageFailures from './repository/imageFailures';
import * as imageMasterCdn from './repository/imageMasterCdn';
import * as imageDemand from './repository/imageDemand';
import type { Clock } from '../infra/clock';

/** Fetch and shrink the set image via the context instead of the import: that way a
 * test replaces network and sharp at the wiring (buildServices) instead of bending modules. */
export interface ImageWorker {
  /** Loads the set image into images/sets; null if it fails (`info.status` names the HTTP code). */
  loadSetImage(url: string, setNumber: string, info?: { status?: number }): Promise<string | null>;
  /** Puts the preview next to the image and returns its path; null if it did not work. */
  createPreview(relPath: string): Promise<string | null>;
}

export interface ImagesDependencies {
  clock: Clock;
  config: Readonly<AppConfig>;
  db: Db;
  compartments: Compartments;
  imageWorker: ImageWorker;
  externalSources: ForeignSourcesServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  readContract: ImagesReadContract;
}

export const access = (db: Db, l: ImagesReadContract) => ({
  imageScope: {
    setsInScope: withContract(db, l)(imageScope.setsInScope),
  },
  imageFailures: {
    freshFailures: bound(db)(imageFailures.freshFailures),
    forgetFailures: bound(db)(imageFailures.forgetFailures),
    forgetAllFailures: bound(db)(imageFailures.forgetAllFailures),
    rememberFailures: bound(db)(imageFailures.rememberFailures),
  },
  imageMasterCdn: {
    cdnToImageMaster: bound(db)(imageMasterCdn.cdnToImageMaster),
  },
  imageDemand: {
    rememberImageRequests: bound(db)(imageDemand.rememberImageRequests),
    deleteOldImageRequests: bound(db)(imageDemand.deleteOldImageRequests),
    countImageRequests: bound(db)(imageDemand.countImageRequests),
    deleteAllImageRequests: bound(db)(imageDemand.deleteAllImageRequests),
    takeImageRequests: bound(db)(imageDemand.takeImageRequestRows),
    seriesCatalogImagesOne: bound(db)(imageDemand.seriesCatalogImagesOne),
  },
});
export type ImagesContext = Context<ImagesDependencies, ReturnType<typeof access>>;
