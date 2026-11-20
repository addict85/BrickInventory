/** Der Bild-Proxy (src/bilder/http/bildProxy.ts) unter BEIDEN Adressen: Die alte
 * steht in Datenbankzeilen und installierten Apps. */
import type { Express, Request, Response } from 'express';
import { passThroughImage, setNumberFromImageAddress } from '../src/bilder/http/bildProxy';
import { guardFor } from './api_v1/middleware';
import { IMG_PROXY_PATH, IMG_PROXY_PATH_LEGACY } from '../src/bilder';
import type { Dienste } from '../src/dienste';

function registerImgProxy(app: Express, d: Pick<Dienste, 'konto' | 'bilder'>) {
  const { requireLoginOrToken, inboundLock } = guardFor(d.konto);
  const durchreichen = (req: Request, res: Response) => passThroughImage(d, req, res);
  app.get(IMG_PROXY_PATH, requireLoginOrToken, inboundLock, durchreichen);
  app.get(IMG_PROXY_PATH_LEGACY, requireLoginOrToken, inboundLock, durchreichen);
}

export { registerImgProxy, passThroughImage, setNumberFromImageAddress };
