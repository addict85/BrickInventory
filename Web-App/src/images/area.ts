/** The images' factory. Their state (buffers, queues, counters) lives in the compartments
 * of this set of services, not in the module: two sets in one process share nothing. */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as imageDemandService from './imageDemand';
import * as bildbedarfLauf from './imageDemandRun';
import { imagesJobTypes } from './jobTypes';
import * as imageMisses from './imageMisses';
import * as imageScopeService from './imageScope';
import * as bildNachschlagen from './imageLookup';
import * as proxyThumbs from './proxyThumbs';
import * as imgCacheServe from './imgCacheServe';
import * as bildDatei from './imageFile';
import * as vorschauenEinpassen from './fitPreviews';
import { setBildHerunterladen } from './setImages';
import { vorschauErzeugenAus } from './thumbs';
import { zugang, type ImageWorker, type ImagesDependencies, type ImagesContext } from './context';

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
    (db: Db) => zugang(db, a.lesevertrag),
    (k: ImagesContext) => ({
      /** Limits of the image proxy and the cache from the passed configuration. */
      imageLimits: () => ({
        cacheMaxBytes: k.konfig.imageCacheMaxMb * 1024 * 1024,
        fetchesJeMinute: k.konfig.imageFetchesJeMinute,
      }),
      deleteExpired: mit(k)(imageDemandService.deleteExpired),
      catalogImagesReserve: mit(k)(imageDemandService.catalogImagesReserve),
      openImageDemand: mit(k)(imageDemandService.openImageDemand),
      emptyImageDemand: mit(k)(imageDemandService.emptyImageDemand),
      imageDemandKick: mit(k)(imageDemandService.imageDemandKick),
      rememberUsed: mit(k)(imageDemandService.rememberUsed),
      imageOnceReserve: mit(k)(imageDemandService.imageOnceReserve),
      auftragsarten: () => imagesJobTypes(k),
      startImageDemand: mit(k)(bildbedarfLauf.setUpImageDemand),
      stopImageDemand: mit(k)(bildbedarfLauf.stopImageDemand),
      atSetImageLoaded: mit(k)(imageDemandService.atSetImageLoaded),
      reportSetImageLoaded: mit(k)(imageDemandService.reportSetImageLoaded),
      // Looked up at call time: a test replaces parts of the image works after construction.
      setBildLaden: (...a: Parameters<ImageWorker['setBildLaden']>) => k.bildwerk.setBildLaden(...a),
      createPreview: (relPath: string) => k.bildwerk.createPreview(relPath),
      forgetMissing: mit(k)(imageMisses.forgetMissing),
      startNone: mit(k)(imageMisses.setUpImageGaps),
      stopNone: mit(k)(imageMisses.stopNone),
      isKnownMissing: mit(k)(imageMisses.isKnownMissing),
      rememberMissing: mit(k)(imageMisses.rememberMissing),
      instructionReleased: mit(k)(imageScopeService.instructionReleased),
      setNumberInScope: mit(k)(imageScopeService.setNumberInScope),
      cdnForMissingImage: mit(k)(bildNachschlagen.cdnForMissingImage),
      queueThumb: mit(k)(proxyThumbs.queueThumb),
      cacheTreffer: mit(k)(imgCacheServe.cacheTreffer),
      cleanImageCacheOn: imgCacheServe.cleanImageCacheOn,
      loadImage: mit(k)(bildDatei.loadImage),
      fitTailoredPreviews: (lokale: { web: string; datei: string }[]) =>
        vorschauenEinpassen.fitTailoredPreviews(k, lokale),
      openImage: (...x: Parameters<ImagesContext['externalSources']['quellen']['oeffneBild']>) =>
        k.externalSources.quellen.oeffneBild(...x),
    }),
    inspect,
  );
}

export type ImagesServices = ReturnType<typeof createImages>;
