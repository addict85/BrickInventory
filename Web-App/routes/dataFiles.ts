/** A file of its own, so a test can mount the real handlers. */
import { guardFor } from './api/middleware';
import { pathSegments } from '../src/http/httpResponse';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { deliverFile, FOREIGN_FILE_CSP } from '../src/http/serveFile';
import { safeDataPath } from '../src/infra/dataPath';

import { signedInUserId } from '../src/account/http/login';
import type { Services } from '../src/services';

type WildcardRequest = Request<{ path: string[] }>;

/** Foreign uploads (only the first bytes checked) thus never run under the app's
 * origin; the own viewer loads via fetch and needs no inline display. */
function asAttachment(res: Response, file: string): void {
  res.setHeader('Content-Security-Policy', FOREIGN_FILE_CSP);
  res.attachment(path.basename(file));
}

export function buildDataFilesRouter(d: Pick<Services, 'household' | 'account' | 'images'>) {
  const { inboundLock, requireLoginOrToken } = guardFor(d.account);
  const router = express.Router();

  // Invoices and vouchers: never into a cache, not even a rejection. Hence before the
  // guards; /data is not under /api and gets no no-store from the app.
  const noStore = (_req: Request, res: Response, next: () => void) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  };

  // The main account sees the uploads of its sub-accounts, not the other way round. A
  // first segment without a user id is rejected.
  router.get(
    '/data/uploads/*pfad',
    noStore,
    requireLoginOrToken,
    inboundLock,
    async (req: WildcardRequest, res: Response) => {
      const userId = signedInUserId(req);
      const segments = pathSegments(req, 'pfad');
      const filePath = safeDataPath('uploads', segments);
      if (!filePath || !/^\d+$/.test(segments[0] ?? '')) return res.status(404).send('Datei nicht gefunden');
      const owner = Number(segments[0]);
      // Even administrators do not read foreign uploads (invoices, vouchers). Foreign
      // answers like missing, so one cannot tell which accounts have files.
      if (!(await d.household.seesAccount(userId, owner))) return res.status(404).send('Datei nicht gefunden');
      asAttachment(res, filePath);
      deliverFile(res, filePath);
    },
  );

  // Stored shared, but under the set number: only for sets in the own scope,
  // otherwise the same 404 as for a missing file.
  router.get(
    '/data/instructions/*pfad',
    requireLoginOrToken,
    inboundLock,
    async (req: WildcardRequest, res: Response) => {
      const segments = pathSegments(req, 'pfad');
      const filePath = safeDataPath('instructions', segments);
      if (!filePath || !(await d.images.instructionReleased(signedInUserId(req), segments)))
        return res.status(404).send('Datei nicht gefunden');
      asAttachment(res, filePath);
      deliverFile(res, filePath);
    },
  );
  return router;
}
