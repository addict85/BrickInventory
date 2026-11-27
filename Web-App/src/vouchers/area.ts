/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as service from './service';
import * as pdfTicket from './pdfTicket';
import { encryptLegacyVoucherFiles } from './voucherFiles';
import { voucherJobKinds } from './nightlyBalances';
import { access, type VoucherDependencies, type VoucherContext } from './context';

export type { VoucherDependencies, VoucherContext } from './context';

export function createVouchers(a: Omit<VoucherDependencies, 'compartments'>, inspect?: Inspect<VoucherContext>) {
  return buildArea(
    { ...a, compartments: new Compartments() },
    access,
    (k: VoucherContext) => ({
      changeVoucher: bound(k)(service.changeVoucher),
      voucherPlaintext: bound(k)(service.voucherPlaintext),
      releasePdf: bound(k)(service.releasePdf),
      checkBalance: bound(k)(service.checkBalance),
      voucherList: bound(k)(service.voucherList),
      createVoucher: bound(k)(service.createVoucher),
      deleteVoucher: bound(k)(service.deleteVoucher),
      restoreVoucher: bound(k)(service.restoreVoucher),
      voucherFromPdf: bound(k)(service.voucherFromPdf),
      exportVouchers: bound(k)(service.exportVouchers),
      voucherPdf: bound(k)(service.voucherPdf),
      redeemTicket: bound(k)(pdfTicket.redeemTicket),
      cleanup: bound(k)(cleanupVouchers),
      jobKinds: () => voucherJobKinds(k),
      // Re-encrypting rows and PDFs at startup (startup/database.ts): across all accounts, without a request.
      reencrypt: bound(k)(reencrypt),
    }),
    inspect,
  );
}

/** Legacy upgrade (default): numbers, copies and PDFs still in v1. Key switch (`all`): every row
 * and file the previous key opens. Rows and files in one call: every caller needs both.
 * @returns how many values were rewritten */
async function reencrypt(k: VoucherContext, o: { all?: boolean } = {}): Promise<number> {
  const rows = o.all
    ? (await k.vouchers.reencryptAllVouchers()) + (await k.vouchers.reencryptCopies(true))
    : (await k.vouchers.reencryptNumbers()) + (await k.vouchers.reencryptCopies());
  return rows + (await encryptLegacyVoucherFiles(o));
}

/** The hourly cleanup: expired PDF tickets and cards deleted longer than RESTORE_DAYS ago. */
async function cleanupVouchers(k: VoucherContext): Promise<number> {
  return (await pdfTicket.cleanupTickets(k)) + (await service.purgeDeletedVouchers(k));
}

export type VoucherServices = ReturnType<typeof createVouchers>;
