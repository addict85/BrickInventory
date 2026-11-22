/** Instructions of a set: reload, upload, delete. */
import type express from 'express';
import path from 'node:path';
import { pathParam } from '../../src/http/httpResponse';
import { failDomain, notFound } from '../../src/infra/errorTexts';
import { accountGate, guardFor } from './middleware';
import {
  uploadQuotaBytes,
  privaterFolder,
  privaterReceive,
  quotaSufficesFor,
  totalSufficesFor,
  uploadTotalMb,
  checkReceivedFile,
} from '../../src/http/fileUpload';
import { INSTRUCTION_ROOT } from '../../src/sets';
import { signedInUserId, isAdmin } from '../../src/account/http/login';
import { released } from '../../src/account/http/stepGuard';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

const uploadQuotaMb = () => Math.round(uploadQuotaBytes() / 1024 / 1024);

/** Ownership and quota BEFORE writing, otherwise up to 50 MB would sit on the disk. */
const beforeTheUpload =
  (d: Pick<Services, 'account' | 'sets'>) =>
  async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const uid = signedInUserId(req);
    if (!(await d.sets.setBelongsAccount(uid, pathParam(req, 'setNumber')))) notFound();
    const length = Number(req.headers['content-length']) || 0;
    if (!(await quotaSufficesFor(path.join(INSTRUCTION_ROOT, String(uid)), length)))
      failDomain('too_large', 'upload_quota_full', { mb: uploadQuotaMb() });
    if (!(await totalSufficesFor(length))) failDomain('storage_full', 'upload_total_full', { mb: uploadTotalMb() });
    next();
  };

export function buildSetsInstructionsRouter(d: Pick<Services, 'account' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('POST /api/v2/sets/:setNumber/instructions', requireToken, async (req, res) => {
    // The administrator deletes shared instructions: the same step guard as every administrator route.
    const admin = isAdmin(req);
    if (admin && !(await released(d.account, req, res, 'admin'))) return;
    const { instructions, job } = await d.sets.loadInstructionsNew(req.apiUser.user_id, req.pathArgs.setNumber, admin);
    res.status(202);
    return { instructions, count: instructions.length, job_id: job };
  });

  const uploadInstr = privaterReceive({
    folder: req => privaterFolder(INSTRUCTION_ROOT, String(signedInUserId(req))),
    prefix: req => pathParam(req, 'setNumber'),
    types: { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' },
    maxBytes: 50 * 1024 * 1024,
  });

  router.endpoint(
    'POST /api/v2/sets/:setNumber/instructions/upload',
    requireToken,
    accountGate('upload'),
    beforeTheUpload(d),
    uploadInstr.single('file'),
    async req => {
      if (!req.file) failDomain('invalid', 'no_file');
      await checkReceivedFile(INSTRUCTION_ROOT, req.file.path, req.file.mimetype);
      const uid = signedInUserId(req),
        sn = req.pathArgs.setNumber;
      const desc = (req.input.description || req.file.originalname).substring(0, 200);
      const relPath = `/data/uploads/${uid}/${req.file.filename}`;
      await d.sets.rememberInstruction(uid, sn, relPath, desc);
      return { instruction: { url: relPath, description: desc, local_path: relPath } };
    },
  );

  router.endpoint('DELETE /api/v2/sets/:setNumber/instructions/:instrId', requireToken, async req => {
    await d.sets.deleteInstruction(signedInUserId(req), req.pathArgs.instrId);
    return {};
  });
  return router;
}
