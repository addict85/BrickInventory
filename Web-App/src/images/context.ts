/** What the image services receive: access, compartments, jobs, household, external sources and the
 * image works. Separate from area.ts so that a service knows its type without an import cycle. */
import type { Konfig } from '../infra/config';
import { withValue, withContract, type Context } from '../infra/area';
import type { ImagesReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
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
  setBildLaden(url: string, setNumber: string, info?: { status?: number }): Promise<string | null>;
  /** Puts the preview next to the image and returns its path; null if it did not work. */
  createPreview(relPath: string): Promise<string | null>;
}

export interface ImagesDependencies {
  uhr: Clock;
  konfig: Readonly<Konfig>;
  db: Db;
  faecher: Faecher;
  bildwerk: ImageWorker;
  externalSources: ForeignSourcesServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  lesevertrag: ImagesReadContract;
}

export const access = (db: Db, l: ImagesReadContract) => ({
  bildBlickfeld: {
    setsInScope: withContract(db, l)(imageScope.setsInScope),
  },
  bildFehlschlaege: {
    freshFailures: withValue(db)(imageFailures.freshFailures),
    forgetFailures: withValue(db)(imageFailures.forgetFailures),
    forgetAllFailures: withValue(db)(imageFailures.forgetAllFailures),
    rememberFailures: withValue(db)(imageFailures.rememberFailures),
  },
  bildStammCdn: {
    cdnZuBildstamm: withValue(db)(imageMasterCdn.cdnToImageMaster),
  },
  bildbedarf: {
    rememberImageRequests: withValue(db)(imageDemand.rememberImageRequests),
    deleteOldImageRequests: withValue(db)(imageDemand.deleteOldImageRequests),
    countImageRequests: withValue(db)(imageDemand.countImageRequests),
    deleteAllImageRequests: withValue(db)(imageDemand.deleteAllImageRequests),
    entnimmBildwuensche: withValue(db)(imageDemand.takeImageRequests),
    seriesCatalogImagesOne: withValue(db)(imageDemand.seriesCatalogImagesOne),
  },
});
export type ImagesContext = Context<ImagesDependencies, ReturnType<typeof access>>;
