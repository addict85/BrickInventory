// For both apps: cookie and token. The work lives in src/vouchers/service.ts.
import type express from 'express';
import multer from 'multer';
import { FORM_LIMITS, totalSufficesFor, uploadTotalMb } from '../../src/http/fileUpload';
import { FOREIGN_FILE_CSP } from '../../src/http/serveFile';
import { Fachfehler, fileError, type ErrorCode, fachfehler } from '../../src/infra/errorTexts';
import { GAP_SEC, TICKET_SEC, readAs, masked, type VoucherRow } from '../../src/vouchers';
import { kontoSchranke, guardFor } from './middleware';
import { confirmWithFactor } from '../../src/account/http/login';
import { pageFrom } from '../../src/infra/page';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';

// Amount once as a number; `hat_pdf` instead of the path, which is nobody's business.
function forOuter(z: VoucherRow) {
  return {
    id: z.id,
    ...masked(z),
    amount: Number(z.amount),
    currency: z.currency,
    hat_pdf: !!z.pdf_path,
    created_at: z.created_at,
    updated_at: z.updated_at,
    // NULL goes along too: a balance never checked should differ from one that was.
    guthaben_geprueft_am: z.guthaben_geprueft_am,
  };
}

/** `wartenSek` goes along, after that the frontend paces itself. */
function gesperrt(grund: string, wartenSek: number): never {
  const min = Math.ceil(wartenSek / 60);
  const [code, vars]: [ErrorCode, Record<string, number>] =
    grund === 'konto'
      ? ['zu_viele_anfragen', { minuten: min }]
      : grund === 'botschutz'
        ? ['guthaben_botschutz', { min }]
        : ['guthaben_abstand', { sek: GAP_SEC, warten: wartenSek }];
  throw new Fachfehler('zu_viele', code, vars, { grund, wartenSek });
}

export function buildVouchersRouter(d: Pick<Dienste, 'account' | 'vouchers'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  /** PDF only: only text is read out, a photo the server could not read anyway. */
  const upload = multer({
    storage: multer.memoryStorage(),
    // 2 MB leaves room for a bundle PDF; more would only keep pdf-lib longer in memory.
    limits: { ...FORM_LIMITS, fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Literal comparison: no inherited table value to be fooled by.
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(fileError('falscher_typ', 'nur_pdf'));
    },
  });

  router.endpunkt('GET /api/v1/vouchers', requireToken, async req => {
    const { eintraege, ...seite } = pageFrom(await d.vouchers.voucherList(req.apiUser.user_id), req.abfrage);
    return { vouchers: eintraege.map(forOuter), ...seite };
  });

  router.endpunkt('POST /api/v1/vouchers', requireToken, async req => {
    return { voucher: forOuter(await d.vouchers.createVoucher(req.apiUser.user_id, req.eingabe)) };
  });

  router.endpunkt(
    'POST /api/v1/vouchers/pdf',
    requireToken,
    kontoSchranke('voucherPdf'),
    async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (!(await totalSufficesFor(Number(req.headers['content-length']) || 0)))
        fachfehler('speicher_voll', 'upload_gesamt_voll', { mb: uploadTotalMb() });
      next();
    },
    upload.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      const r = await d.vouchers.voucherFromPdf(req.apiUser.user_id, req.file.buffer, req.eingabe);
      // Its own block so the frontend can tell from one field which case happened.
      if (r.art === 'stapel') return { mehrere: r.bericht };
      return { voucher: forOuter(r.zeile), gelesen: readAs(r.gelesen) };
    },
  );

  // The batch paths BEFORE the :id paths: otherwise `:id` would catch the word "export".

  router.endpunkt('POST /api/v1/vouchers/export/pdf-freigabe', requireToken, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ticket: await d.vouchers.releaseExport(req.apiUser.user_id), gueltig_sek: TICKET_SEC };
  });

  router.endpunkt('GET /api/v1/vouchers/export/pdf', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!d.vouchers.redeemTicket(req.abfrage.ticket, uid, 'export')) fachfehler('verboten', 'pdf_freigabe_noetig');
    const { pdf, results } = await d.vouchers.exportVouchers(uid);
    const tag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-gutscheine-${tag}.pdf"`);
    // base64: an umlaut in the reason would otherwise break the header line.
    res.setHeader('X-Gutschein-Befunde', Buffer.from(JSON.stringify(results), 'utf-8').toString('base64'));
    res.setHeader('Access-Control-Expose-Headers', 'X-Gutschein-Befunde');
    res.end(pdf);
  });

  router.endpunkt('PUT /api/v1/vouchers/:id', requireToken, async req => {
    const id = req.pfad.id;
    return { voucher: forOuter(await d.vouchers.changeVoucher(req.apiUser.user_id, id, req.eingabe)) };
  });

  // Final and cash: with confirmation, like emptying the trash.
  router.endpunkt('DELETE /api/v1/vouchers/:id', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    await d.vouchers.deleteVoucher(req.apiUser.user_id, id);
    return {};
  });

  router.endpunkt('POST /api/v1/vouchers/:id/klartext', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    const z = await d.vouchers.voucherPlaintext(req.apiUser.user_id, id);
    return { id: z.id, number: z.number, pin: z.pin };
  });

  router.endpunkt('POST /api/v1/vouchers/:id/pdf-freigabe', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!(await confirmWithFactor(d.account, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ticket: await d.vouchers.releasePdf(req.apiUser.user_id, id), gueltig_sek: TICKET_SEC };
  });

  router.endpunkt('GET /api/v1/vouchers/:id/pdf', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!d.vouchers.redeemTicket(req.abfrage.ticket, req.apiUser.user_id, String(id)))
      fachfehler('verboten', 'pdf_freigabe_noetig');
    const pdf = await d.vouchers.voucherPdf(req.apiUser.user_id, id);
    res.type('application/pdf');
    // Without the card number: file names end up in download lists and logs.
    const art = (req.abfrage.download ?? false) ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${art}; filename="gutschein-${id}.pdf"`);
    // A voucher belongs in no shared cache.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', FOREIGN_FILE_CSP);
    res.end(pdf);
  });

  // No batch route: at most one fetch every 30s across ALL users, that would hide them.
  router.endpunkt('POST /api/v1/vouchers/:id/guthaben', requireToken, async req => {
    const id = req.pfad.id;
    const r = await d.vouchers.checkBalance(req.apiUser.user_id, id);
    if (r.art === 'gesperrt') gesperrt(r.grund, r.wartenSek);
    return {
      voucher: forOuter(r.zeile),
      angezeigt: r.angezeigt,
      // A silently changed currency would be a changed total without a hint.
      waehrung_geaendert: r.currencyChanged,
    };
  });
  return router;
}
