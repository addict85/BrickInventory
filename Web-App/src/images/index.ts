/** The public face of the area; whatever needs access or state only via the services. */
export { requestsPerMinute } from './imageDemand';
export { fileMaster } from './imageScope';
export { imageExtension, filePart, targetInFolder } from './imageFile';
export {
  IMG_PROXY_PATH,
  IMG_PROXY_PATH_LEGACY,
  proxyCachePathFor,
  proxyCacheKey,
  proxyImageUrl,
  imageIfPresent,
  resolveImageLocal,
} from './images';
export { imgProxyFailures } from './imgProxyStats';
export { rebrickableSetImage } from './setImages';
export { createImages } from './area';
export type { ImagesDependencies, ImagesServices, ImagesContext, ImageWorker } from './area';
