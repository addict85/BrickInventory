/** Der Bild-Proxy (src/katalog/http/bildProxy.ts) unter BEIDEN Adressen: Die alte
 * steht in Datenbankzeilen und installierten Apps. */
import type { Express } from 'express';
import { bildDurchreichen, setNummerAusBildAdresse } from '../src/katalog/http/bildProxy';
import { requireLoginOrToken } from '../src/konto/http/anmeldung';
import { eingangsSperre } from './api_v1/middleware';
import { IMG_PROXY_PFAD, IMG_PROXY_PFAD_ALT } from '../src/katalog';

function registerImgProxy(app: Express) {
  app.get(IMG_PROXY_PFAD, requireLoginOrToken, eingangsSperre, bildDurchreichen);
  app.get(IMG_PROXY_PFAD_ALT, requireLoginOrToken, eingangsSperre, bildDurchreichen);
}

export { registerImgProxy, bildDurchreichen, setNummerAusBildAdresse };
