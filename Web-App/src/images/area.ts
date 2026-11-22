/** The images' factory. Their state (buffers, queues, counters) lives in the compartments
 * of this set of services, not in the module: two sets in one process share nothing. */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as imageDemandService from './imageDemand';
import * as imageDemandRun from './imageDemandRun';
import { imagesJobTypes } from './jobTypes';
import * as imageMisses from './imageMisses';
import * as imageScopeService from './imageScope';
import * as imageLookup from './imageLookup';
import * as proxyThumbs from './proxyThumbs';
import * as imgCacheServe from './imgCacheServe';
import * as imageFile from './imageFile';
import * as fitPreviews from './fitPreviews';
import { downloadSetImage } from './setImages';
import { previewFrom } from './thumbs';
import { access, type ImageWorker, type ImagesDependencies, type ImagesContext } from './context';

export type { ImageWorker, ImagesDependencies, ImagesContext } from './context';

/** Without `bildwerk` the real one; a test passes its own (startup/wiring.ts buildServices). */
export function createImages(
  a: Omit<ImagesDependencies, 'faecher' | 'bildwerk'> & { bildwerk?: ImageWorker | undefined },
  inspect?: Inspect<ImagesContext>,
) {
  const bildwerk = a.bildwerk ?? {
    loadSetImage: (url: string, sn: string, info?: { status?: number }) => downloadSetImage(a, url, sn, info),
    createPreview: previewFrom,
  };
  return buildArea(
    { ...a, bildwerk, faecher: new Compartments() },
    (db: Db) => access(db, a.lesevertrag),
    (k: ImagesContext) => ({
      /** Limits of the image proxy and the cache from the passed configuration. */
      imageLimits: () => ({
        cacheMaxBytes: k.konfig.imageCacheMaxMb * 1024 * 1024,
        fetchesJeMinute: k.konfig.imageFetchesJeMinute,
      }),
      deleteExpired: bound(k)(imageDemandService.deleteExpired),
      catalogImagesReserve: bound(k)(imageDemandService.catalogImagesReserve),
      openImageDemand: bound(k)(imageDemandService.openImageDemand),
      emptyImageDemand: bound(k)(imageDemandService.emptyImageDemand),
      imageDemandKick: bound(k)(imageDemandService.imageDemandKick),
      rememberUsed: bound(k)(imageDemandService.rememberUsed),
      imageOnceReserve: bound(k)(imageDemandService.imageOnceReserve),
      jobKinds: () => imagesJobTypes(k),
      startImageDemand: bound(k)(imageDemandRun.setUpImageDemand),
      stopImageDemand: bound(k)(imageDemandRun.stopImageDemand),
      atSetImageLoaded: bound(k)(imageDemandService.atSetImageLoaded),
      reportSetImageLoaded: bound(k)(imageDemandService.reportSetImageLoaded),
      // Looked up at call time: a test replaces parts of the image works after construction.
      loadSetImage: (...a: Parameters<ImageWorker['loadSetImage']>) => k.bildwerk.loadSetImage(...a),
      createPreview: (relPath: string) => k.bildwerk.createPreview(relPath),
      forgetMissing: bound(k)(imageMisses.forgetMissing),
      startNone: bound(k)(imageMisses.setUpImageGaps),
      stopNone: bound(k)(imageMisses.stopNone),
      isKnownMissing: bound(k)(imageMisses.isKnownMissing),
      rememberMissing: bound(k)(imageMisses.rememberMissing),
      instructionReleased: bound(k)(imageScopeService.instructionReleased),
      setNumberInScope: bound(k)(imageScopeService.setNumberInScope),
      cdnForMissingImage: bound(k)(imageLookup.cdnForMissingImage),
      queueThumb: bound(k)(proxyThumbs.queueThumb),
      cacheTreffer: bound(k)(imgCacheServe.cacheHit),
      cleanImageCacheOn: imgCacheServe.cleanImageCacheOn,
      loadImage: bound(k)(imageFile.loadImage),
      fitTailoredPreviews: (local: { web: string; datei: string }[]) => fitPreviews.fitTailoredPreviews(k, local),
      openImage: (...x: Parameters<ImagesContext['externalSources']['quellen']['oeffneBild']>) =>
        k.externalSources.quellen.oeffneBild(...x),
    }),
    inspect,
  );
}

export type ImagesServices = ReturnType<typeof createImages>;
