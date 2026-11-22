/** The images' factory. Their state (buffers, queues, counters) lives in the compartments
 * of this set of services, not in the module: two sets in one process share nothing. */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as imageDemandService from './imageDemand';
import * as bildbedarfLauf from './imageDemandRun';
import { imagesJobTypes } from './jobTypes';
import * as imageMisses from './imageMisses';
import * as imageScopeService from './imageScope';
import * as imageLookup from './imageLookup';
import * as proxyThumbs from './proxyThumbs';
import * as imgCacheServe from './imgCacheServe';
import * as imageFile from './imageFile';
import * as fitPreviews from './fitPreviews';
import { setBildHerunterladen } from './setImages';
import { vorschauErzeugenAus } from './thumbs';
import { access, type ImageWorker, type ImagesDependencies, type ImagesContext } from './context';

export type { ImageWorker, ImagesDependencies, ImagesContext } from './context';

/** Without `bildwerk` the real one; a test passes its own (startup/wiring.ts buildServices). */
export function createImages(
  a: Omit<ImagesDependencies, 'faecher' | 'bildwerk'> & { bildwerk?: ImageWorker | undefined },
  inspect?: Inspect<ImagesContext>,
) {
  const bildwerk = a.bildwerk ?? {
    setBildLaden: (url: string, sn: string, info?: { status?: number }) => setBildHerunterladen(a, url, sn, info),
    createPreview: vorschauErzeugenAus,
  };
  return buildArea(
    { ...a, bildwerk, faecher: new Faecher() },
    (db: Db) => access(db, a.lesevertrag),
    (k: ImagesContext) => ({
      /** Limits of the image proxy and the cache from the passed configuration. */
      imageLimits: () => ({
        cacheMaxBytes: k.konfig.imageCacheMaxMb * 1024 * 1024,
        fetchesJeMinute: k.konfig.imageFetchesJeMinute,
      }),
      deleteExpired: withValue(k)(imageDemandService.deleteExpired),
      catalogImagesReserve: withValue(k)(imageDemandService.catalogImagesReserve),
      openImageDemand: withValue(k)(imageDemandService.openImageDemand),
      emptyImageDemand: withValue(k)(imageDemandService.emptyImageDemand),
      imageDemandKick: withValue(k)(imageDemandService.imageDemandKick),
      rememberUsed: withValue(k)(imageDemandService.rememberUsed),
      imageOnceReserve: withValue(k)(imageDemandService.imageOnceReserve),
      auftragsarten: () => imagesJobTypes(k),
      startImageDemand: withValue(k)(bildbedarfLauf.setUpImageDemand),
      stopImageDemand: withValue(k)(bildbedarfLauf.stopImageDemand),
      atSetImageLoaded: withValue(k)(imageDemandService.atSetImageLoaded),
      reportSetImageLoaded: withValue(k)(imageDemandService.reportSetImageLoaded),
      // Looked up at call time: a test replaces parts of the image works after construction.
      setBildLaden: (...a: Parameters<ImageWorker['setBildLaden']>) => k.bildwerk.setBildLaden(...a),
      createPreview: (relPath: string) => k.bildwerk.createPreview(relPath),
      forgetMissing: withValue(k)(imageMisses.forgetMissing),
      startNone: withValue(k)(imageMisses.setUpImageGaps),
      stopNone: withValue(k)(imageMisses.stopNone),
      isKnownMissing: withValue(k)(imageMisses.isKnownMissing),
      rememberMissing: withValue(k)(imageMisses.rememberMissing),
      instructionReleased: withValue(k)(imageScopeService.instructionReleased),
      setNumberInScope: withValue(k)(imageScopeService.setNumberInScope),
      cdnForMissingImage: withValue(k)(imageLookup.cdnForMissingImage),
      queueThumb: withValue(k)(proxyThumbs.queueThumb),
      cacheTreffer: withValue(k)(imgCacheServe.cacheTreffer),
      cleanImageCacheOn: imgCacheServe.cleanImageCacheOn,
      loadImage: withValue(k)(imageFile.loadImage),
      fitTailoredPreviews: (local: { web: string; datei: string }[]) => fitPreviews.fitTailoredPreviews(k, local),
      openImage: (...x: Parameters<ImagesContext['externalSources']['quellen']['oeffneBild']>) =>
        k.externalSources.quellen.oeffneBild(...x),
    }),
    inspect,
  );
}

export type ImagesServices = ReturnType<typeof createImages>;
