/** ONE logged-in route for all images under /images/: own uploads must not
 * go out without login, a foreign set image answers like a missing one. */
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { userIdTheRequest } from '../../account/http/login';
import { safeDataPath } from '../../infra/dataPath';
import { pathSegments } from '../../http/httpResponse';
import { responseOnFileError, deliverFile, sendFile } from '../../http/serveFile';
import { countProxyError } from '../imgProxyStats';
import { imageReleased } from '../imageScope';
import { previewFrom, previewType } from '../thumbs';
import { IMG_PROXY_PATH } from '../images';
import type { ImageServices } from './imageProxy';

/** If the preview is missing, the original goes out immediately and the preview is created
 * on the side; if it failed on capture, there would otherwise be no second chance. */
async function originalInsteadOfPreview(res: Response, segments: string[]): Promise<boolean> {
  const rawPath = segments.join('/');
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
    void previewFrom('/images/' + originalSegs.join('/')).catch(e => countProxyError('images:vorschau', e));
  });
  deliverFile(res, originalPath);
  return true;
}

export async function deliverImage(d: ImageServices, req: Request, res: Response) {
  const imgUserId = await userIdTheRequest(d.account, req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');
  const segments = pathSegments(req, 'pfad');
  const filePath = safeDataPath('images', segments);
  if (!filePath || !(await imageReleased(imgUserId, segments))) return res.status(404).send('Datei nicht gefunden');
  // private: the response depends on a login. max-age=0 so that a replaced image applies immediately.
  res.setHeader('Cache-Control', 'private, max-age=0');
  if (/_thumb\.jpg$/.test(filePath)) res.type(await previewType(filePath));
  sendFile(res, filePath, async err => {
    if (!err || res.headersSent) return;
    // An error WITH its own number (416, 403) is not a missing file.
    const status = (err as { status?: number }).status;
    if (status && status !== 404) return responseOnFileError(res, err);
    if (await originalInsteadOfPreview(res, segments)) return;
    // If the file is missing, via the image proxy to the CDN address: heals without cleanup in the DB.
    const cdn = await d.images.cdnForMissingImage('/images/' + segments.join('/'));
    if (cdn && !res.headersSent) return res.redirect(302, IMG_PROXY_PATH + '?url=' + encodeURIComponent(cdn));
    responseOnFileError(res, err);
  });
}
