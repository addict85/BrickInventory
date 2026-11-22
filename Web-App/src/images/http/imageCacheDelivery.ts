import type { ServerResponse } from 'node:http';
import type { ImagesServices } from '../area';

type ImageResponse = ServerResponse & { status(c: number): { end(): unknown } };
interface ImageRequest {
  fresh: boolean;
  headers?: Record<string, unknown>;
}

/** From the disk cache, if present; true means answered. */
export async function deliverFromCache(
  images: Pick<ImagesServices, 'cacheHit'>,
  opts: {
    res: ImageResponse;
    req: ImageRequest;
    cacheFile: string;
    thumbFile: string;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
    streamFileToResponse(res: ImageResponse, file: string, onEnd?: () => void, req?: ImageRequest): unknown;
  },
): Promise<boolean> {
  const { res, req, streamFileToResponse } = opts;
  const hits = await images.cacheHit(opts);
  if (!hits) return false;
  res.setHeader('Content-Type', hits.contentType);
  // Pass the length: a reverse proxy may buffer a chunked response.
  if (hits.size !== null) res.setHeader('Content-Length', String(hits.size));
  if (hits.etag) res.setHeader('ETag', hits.etag);
  res.setHeader('Cache-Control', 'private, max-age=86400, must-revalidate');
  // If the browser already knows the file, an empty 304 is enough.
  if (req.fresh) {
    res.status(304).end();
    return true;
  }
  // No raw pipe(): cache maintenance can remove the file between check and
  // opening, and a read stream error without listeners ends the process.
  streamFileToResponse(res, hits.file, undefined, req);
  return true;
}
