// For both apps: cookie and token. The work lives in src/vouchers/service.ts.
import type express from 'express';
import multer from 'multer';
import { FORM_LIMITS, totalSufficesFor, uploadTotalMb } from '../../src/http/fileUpload';
import { FOREIGN_FILE_CSP } from '../../src/http/serveFile';
import { DomainError, fileError, type ErrorCode, failDomain } from '../../src/infra/errorTexts';
import { GAP_SEC, TICKET_SEC, readAs, masked, type VoucherRow } from '../../src/vouchers';
import { accountGate, guardFor } from './middleware';
import { confirmWithFactor } from '../../src/account/http/login';
import { pageFrom } from '../../src/infra/page';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

// Amount once as a number; `hat_pdf` instead of the path, which is nobody's business.
function forOuter(z: VoucherRow) {
  return {
    id: z.id,
    ...masked(z),
    amount: Number(z.amount),
    currency: z.currency,
    has_pdf: !!z.pdf_path,
    created_at: z.created_at,
    updated_at: z.updated_at,
    // NULL goes along too: a balance never checked should differ from one that was.
    balance_checked_at: z.balance_checked_at,
  };
}

/** `wartenSek` goes along, after that the frontend paces itself. */
function locked(reason: string, waitSeconds: number): never {
  const min = Math.ceil(waitSeconds / 60);
  const [code, vars]: [ErrorCode, Record<string, number>] =
    reason === 'konto'
      ? ['too_many_requests', { minutes: min }]
      : reason === 'botschutz'
        ? ['balance_bot_protection', { min }]
        : ['balance_interval', { sek: GAP_SEC, wait: waitSeconds }];
  throw new DomainError('too_many', code, vars, { reason, waitSeconds });
}

export function buildVouchersRouter(d: Pick<Services, 'account' | 'vouchers'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  /** PDF only: only text is read out, a photo the server could not read anyway. */
  const upload = multer({
    storage: multer.memoryStorage(),
    // 2 MB leaves room for a bundle PDF; more would only keep pdf-lib longer in memory.
    limits: { ...FORM_LIMITS, fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Literal comparison: no inherited table value to be fooled by.
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(fileError('unsupported_type', 'pdf_only'));
    },
  });

  router.endpoint('GET /api/v2/vouchers', requireToken, async req => {
    const { entries, ...page } = pageFrom(await d.vouchers.voucherList(req.apiUser.user_id), req.queryArgs);
    return { vouchers: entries.map(forOuter), ...page };
  });

  router.endpoint('POST /api/v2/vouchers', requireToken, async req => {
    return { voucher: forOuter(await d.vouchers.createVoucher(req.apiUser.user_id, req.input)) };
  });

  router.endpoint(
    'POST /api/v2/vouchers/pdf',
    requireToken,
    accountGate('voucherPdf'),
    async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (!(await totalSufficesFor(Number(req.headers['content-length']) || 0)))
        failDomain('storage_full', 'upload_total_full', { mb: uploadTotalMb() });
      next();
    },
    upload.single('file'),
    async req => {
      if (!req.file) failDomain('invalid', 'no_file');
      const r = await d.vouchers.voucherFromPdf(req.apiUser.user_id, req.file.buffer, req.input);
      // Its own block so the frontend can tell from one field which case happened.
      if (r.kind === 'stapel') return { multiple: r.report };
      return { voucher: forOuter(r.row), parsed: readAs(r.parsed) };
    },
  );

  // The batch paths BEFORE the :id paths: otherwise `:id` would catch the word "export".

  router.endpoint('POST /api/v2/vouchers/export/pdf-grant', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    return { ticket: await d.vouchers.releasePdf(req.apiUser.user_id, null), valid_seconds: TICKET_SEC };
  });

  router.endpoint('GET /api/v2/vouchers/export/pdf', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!(await d.vouchers.redeemTicket(req.queryArgs.ticket, uid, 'export')))
      failDomain('forbidden', 'pdf_grant_required');
    const { pdf, results } = await d.vouchers.exportVouchers(uid);
    const tag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-gutscheine-${tag}.pdf"`);
    // base64: an umlaut in the reason would otherwise break the header line.
    res.setHeader('X-Gutschein-Befunde', Buffer.from(JSON.stringify(results), 'utf-8').toString('base64'));
    res.setHeader('Access-Control-Expose-Headers', 'X-Gutschein-Befunde');
    res.end(pdf);
  });

  router.endpoint('PUT /api/v2/vouchers/:id', requireToken, async req => {
    const id = req.pathArgs.id;
    return { voucher: forOuter(await d.vouchers.changeVoucher(req.apiUser.user_id, id, req.input)) };
  });

  // Cash: with confirmation, even though it stays restorable for a few days (restoreVoucher).
  router.endpoint('DELETE /api/v2/vouchers/:id', requireToken, async (req, res) => {
    const id = req.pathArgs.id;
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    await d.vouchers.deleteVoucher(req.apiUser.user_id, id);
    return {};
  });

  router.endpoint('POST /api/v2/vouchers/:id/restore', requireToken, async req => {
    return { voucher: forOuter(await d.vouchers.restoreVoucher(req.apiUser.user_id, req.pathArgs.id)) };
  });

  router.endpoint('POST /api/v2/vouchers/:id/plaintext', requireToken, async (req, res) => {
    const id = req.pathArgs.id;
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    const z = await d.vouchers.voucherPlaintext(req.apiUser.user_id, id);
    return { id: z.id, number: z.number, pin: z.pin };
  });

  router.endpoint('POST /api/v2/vouchers/:id/pdf-grant', requireToken, async (req, res) => {
    const id = req.pathArgs.id;
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.input.password))) return;
    return { ticket: await d.vouchers.releasePdf(req.apiUser.user_id, id), valid_seconds: TICKET_SEC };
  });

  router.endpoint('GET /api/v2/vouchers/:id/pdf', requireToken, async (req, res) => {
    const id = req.pathArgs.id;
    if (!(await d.vouchers.redeemTicket(req.queryArgs.ticket, req.apiUser.user_id, String(id))))
      failDomain('forbidden', 'pdf_grant_required');
    const pdf = await d.vouchers.voucherPdf(req.apiUser.user_id, id);
    res.type('application/pdf');
    // Without the card number: file names end up in download lists and logs.
    const kind = (req.queryArgs.download ?? false) ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${kind}; filename="gutschein-${id}.pdf"`);
    // A voucher belongs in no shared cache.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', FOREIGN_FILE_CSP);
    res.end(pdf);
  });

  // No batch route: at most one fetch every 30s across ALL users, that would hide them.
  router.endpoint('POST /api/v2/vouchers/:id/balance', requireToken, async req => {
    const id = req.pathArgs.id;
    const r = await d.vouchers.checkBalance(req.apiUser.user_id, id);
    if (r.kind === 'gesperrt') locked(r.reason, r.waitSeconds);
    return {
      voucher: forOuter(r.row),
      displayed: r.displayed,
      // A silently changed currency would be a changed total without a hint.
      currency_changed: r.currencyChanged,
    };
  });
  return router;
}
