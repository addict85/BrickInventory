/** EINE angemeldete Route für alle Bilder unter /images/: Eigene Uploads dürfen
 * nicht ohne Anmeldung hinaus, ein fremdes Set-Bild antwortet wie ein fehlendes. */
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { userIdTheRequest } from '../../konto/http/anmeldung';
import { safeDataPath } from '../../infra/datenPfad';
import { pathSegments } from '../../http/httpAntwort';
import { responseOnFileError, deliverFile, sendeDatei } from '../../http/dateiAusliefern';
import { countProxyError } from '../imgProxyStats';
import { imageReleased } from '../imageScope';
import { vorschauErzeugenAus, previewType } from '../thumbs';
import { IMG_PROXY_PATH } from '../images';
import type { ImageServices } from './imageProxy';

/** Fehlt die Vorschau, geht sofort das Original hinaus und die Vorschau entsteht
 * nebenher; scheiterte sie beim Erfassen, gäbe es sonst keinen zweiten Anlauf. */
async function originalInsteadOfPreview(res: Response, segmente: string[]): Promise<boolean> {
  const rawPath = segmente.join('/');
  if (!/_thumb(\.[^.]+)$/.test(rawPath)) return false;
  const originalSegs = rawPath
    .replace(/_thumb(\.[^.]+)$/, '$1')
    .split('/')
    .filter(Boolean);
  const originalPath = safeDataPath('images', originalSegs);
  if (
    !originalPath ||
    !(await fs.promises.access(originalPath).then(
      () => true,
      () => false,
    ))
  )
    return false;
  setImmediate(() => {
    void vorschauErzeugenAus('/images/' + originalSegs.join('/')).catch(e => countProxyError('bilder:vorschau', e));
  });
  deliverFile(res, originalPath);
  return true;
}

export async function deliverImage(d: ImageServices, req: Request, res: Response) {
  const imgUserId = await userIdTheRequest(d.konto, req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');
  const segmente = pathSegments(req, 'pfad');
  const filePath = safeDataPath('images', segmente);
  if (!filePath || !(await imageReleased(imgUserId, segmente))) return res.status(404).send('Datei nicht gefunden');
  // private: Die Antwort hängt an einer Anmeldung. max-age=0, damit ein ersetztes Bild sofort gilt.
  res.setHeader('Cache-Control', 'private, max-age=0');
  if (/_thumb\.jpg$/.test(filePath)) res.type(await previewType(filePath));
  sendeDatei(res, filePath, async err => {
    if (!err || res.headersSent) return;
    // Ein Fehler MIT eigener Zahl (416, 403) ist keine fehlende Datei.
    const status = (err as { status?: number }).status;
    if (status && status !== 404) return responseOnFileError(res, err);
    if (await originalInsteadOfPreview(res, segmente)) return;
    // Fehlt die Datei, über den Bild-Proxy zur CDN-Adresse: heilt ohne Aufräumen in der DB.
    const cdn = await d.images.cdnForMissingImage('/images/' + segmente.join('/'));
    if (cdn && !res.headersSent) return res.redirect(302, IMG_PROXY_PATH + '?url=' + encodeURIComponent(cdn));
    responseOnFileError(res, err);
  });
}
