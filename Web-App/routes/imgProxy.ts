/** The image proxy (src/images/http/imageProxy.ts) under BOTH addresses: the old one
 * is stored in database rows and installed apps. */
import type { Express, Request, Response } from 'express';
import { passThroughImage, setNumberFromImageAddress } from '../src/images/http/imageProxy';
import { guardFor } from './api/middleware';
import { IMG_PROXY_PATH, IMG_PROXY_PATH_LEGACY } from '../src/images';
import type { Services } from '../src/services';

function registerImgProxy(app: Express, d: Pick<Services, 'account' | 'images'>) {
  const { requireLoginOrToken, inboundLock } = guardFor(d.account);
  const passThrough = (req: Request, res: Response) => passThroughImage(d, req, res);
  app.get(IMG_PROXY_PATH, requireLoginOrToken, inboundLock, passThrough);
  app.get(IMG_PROXY_PATH_LEGACY, requireLoginOrToken, inboundLock, passThrough);
}

export { registerImgProxy, passThroughImage, setNumberFromImageAddress };
