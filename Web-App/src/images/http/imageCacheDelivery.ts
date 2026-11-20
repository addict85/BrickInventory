import type { ServerResponse } from 'node:http';
import type { ImagesServices } from '../area';

type ImageResponse = ServerResponse & { status(c: number): { end(): unknown } };
interface ImageRequest {
  fresh: boolean;
  headers?: Record<string, unknown>;
}

/** From the disk cache, if present; true means answered. */
export async function deliverFromCache(
  bilder: Pick<ImagesServices, 'cacheTreffer'>,
  opts: {
    res: ImageResponse;
    req: ImageRequest;
    cacheFile: string;
    thumbFile: string;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
    streamFileToResponse(res: ImageResponse, datei: string, onEnd?: () => void, req?: ImageRequest): unknown;
  },
): Promise<boolean> {
  const { res, req, streamFileToResponse } = opts;
  const treffer = await bilder.cacheTreffer(opts);
  if (!treffer) return false;
  res.setHeader('Content-Type', treffer.typ);
  // Pass the length: a reverse proxy may buffer a chunked response.
  if (treffer.groesse !== null) res.setHeader('Content-Length', String(treffer.groesse));
  if (treffer.etag) res.setHeader('ETag', treffer.etag);
  res.setHeader('Cache-Control', 'private, max-age=86400, must-revalidate');
  // If the browser already knows the file, an empty 304 is enough.
  if (req.fresh) {
    res.status(304).end();
    return true;
  }
  // No raw pipe(): cache maintenance can remove the file between check and
  // opening, and a read stream error without listeners ends the process.
  streamFileToResponse(res, treffer.datei, undefined, req);
  return true;
}
