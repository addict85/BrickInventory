/** Der Bild-Proxy (src/images/http/imageProxy.ts) unter BEIDEN Adressen: Die alte
 * steht in Datenbankzeilen und installierten Apps. */
import type { Express, Request, Response } from 'express';
import { passThroughImage, setNumberFromImageAddress } from '../src/images/http/imageProxy';
import { guardFor } from './api_v1/middleware';
import { IMG_PROXY_PATH, IMG_PROXY_PATH_LEGACY } from '../src/images';
import type { Dienste } from '../src/services';

function registerImgProxy(app: Express, d: Pick<Dienste, 'account' | 'images'>) {
  const { requireLoginOrToken, inboundLock } = guardFor(d.account);
  const durchreichen = (req: Request, res: Response) => passThroughImage(d, req, res);
  app.get(IMG_PROXY_PATH, requireLoginOrToken, inboundLock, durchreichen);
  app.get(IMG_PROXY_PATH_LEGACY, requireLoginOrToken, inboundLock, durchreichen);
}

export { registerImgProxy, passThroughImage, setNumberFromImageAddress };
