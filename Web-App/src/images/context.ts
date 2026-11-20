/** What the image services receive: access, compartments, jobs, household, external sources and the
 * image works. Separate from area.ts so that a service knows its type without an import cycle. */
import type { Konfig } from '../infra/config';
import { mit, withContract, type Kontext } from '../infra/area';
import type { ImagesReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
import type { Db } from '../../db/database';
import type { JobsServices } from '../jobQueue';
import type { ForeignSourcesServices } from '../externalSources';
import type { HouseholdServices } from '../household';
import * as bildBlickfeld from './repository/imageScope';
import * as bildFehlschlaege from './repository/imageFailures';
import * as bildStammCdn from './repository/imageMasterCdn';
import * as bildbedarf from './repository/imageDemand';
import type { Uhr } from '../infra/clock';

/** Fetch and shrink the set image via the context instead of the import: that way a
 * test replaces network and sharp at the wiring (buildServices) instead of bending modules. */
export interface ImageWorker {
  /** Loads the set image into images/sets; null if it fails (`info.status` names the HTTP code). */
  setBildLaden(url: string, setNumber: string, info?: { status?: number }): Promise<string | null>;
  /** Puts the preview next to the image and returns its path; null if it did not work. */
  createPreview(relPath: string): Promise<string | null>;
}

export interface ImagesDependencies {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  faecher: Faecher;
  bildwerk: ImageWorker;
  externalSources: ForeignSourcesServices;
  jobQueue: JobsServices;
  household: HouseholdServices;
  lesevertrag: ImagesReadContract;
}

export const zugang = (db: Db, l: ImagesReadContract) => ({
  bildBlickfeld: {
    setsInScope: withContract(db, l)(bildBlickfeld.setsInScope),
  },
  bildFehlschlaege: {
    freshFailures: mit(db)(bildFehlschlaege.freshFailures),
    forgetFailures: mit(db)(bildFehlschlaege.forgetFailures),
    forgetAllFailures: mit(db)(bildFehlschlaege.forgetAllFailures),
    rememberFailures: mit(db)(bildFehlschlaege.rememberFailures),
  },
  bildStammCdn: {
    cdnZuBildstamm: mit(db)(bildStammCdn.cdnZuBildstamm),
  },
  bildbedarf: {
    rememberImageRequests: mit(db)(bildbedarf.rememberImageRequests),
    deleteOldImageRequests: mit(db)(bildbedarf.deleteOldImageRequests),
    countImageRequests: mit(db)(bildbedarf.countImageRequests),
    deleteAllImageRequests: mit(db)(bildbedarf.deleteAllImageRequests),
    entnimmBildwuensche: mit(db)(bildbedarf.entnimmBildwuensche),
    seriesCatalogImagesOne: mit(db)(bildbedarf.seriesCatalogImagesOne),
  },
});
export type ImagesContext = Kontext<ImagesDependencies, ReturnType<typeof zugang>>;
