/** Der Bild-Proxy (src/katalog/http/bildProxy.ts) unter BEIDEN Adressen: Die alte
 * steht in Datenbankzeilen und installierten Apps. */
import type { Express, Request, Response } from 'express';
import { bildDurchreichen, setNummerAusBildAdresse } from '../src/katalog/http/bildProxy';
import { waechterFuer } from './api_v1/middleware';
import { IMG_PROXY_PFAD, IMG_PROXY_PFAD_ALT } from '../src/katalog';
import type { Dienste } from '../src/dienste';

function registerImgProxy(app: Express, d: Pick<Dienste, 'konto' | 'katalog'>) {
  const { requireLoginOrToken, eingangsSperre } = waechterFuer(d.konto);
  const durchreichen = (req: Request, res: Response) => bildDurchreichen(d, req, res);
  app.get(IMG_PROXY_PFAD, requireLoginOrToken, eingangsSperre, durchreichen);
  app.get(IMG_PROXY_PFAD_ALT, requireLoginOrToken, eingangsSperre, durchreichen);
}

export { registerImgProxy, bildDurchreichen, setNummerAusBildAdresse };
