/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import * as service from './service';
import * as pdfTicket from './pdfTicket';
import { encryptLegacyVoucherFiles } from './voucherFiles';
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
      releaseExport: bound(k)(service.releaseExport),
      checkBalance: bound(k)(service.checkBalance),
      voucherList: bound(k)(service.voucherList),
      createVoucher: bound(k)(service.createVoucher),
      deleteVoucher: bound(k)(service.deleteVoucher),
      voucherFromPdf: bound(k)(service.voucherFromPdf),
      exportVouchers: bound(k)(service.exportVouchers),
      voucherPdf: bound(k)(service.voucherPdf),
      redeemTicket: bound(k)(pdfTicket.redeemTicket),
      cleanupTickets: bound(k)(pdfTicket.cleanupTickets),
      encryptLegacyFiles: encryptLegacyVoucherFiles,
      // Re-encrypting at startup (startup/database.ts): across all accounts, without a request.
      reencrypt: bound(k)(reencrypt),
    }),
    inspect,
  );
}

/** Legacy upgrade (default): numbers and copies still in v1. Key switch (`all`): every row the
 * previous key opens. @returns how many values were rewritten */
async function reencrypt(k: VoucherContext, o: { all?: boolean } = {}): Promise<number> {
  return o.all
    ? (await k.vouchers.reencryptAllVouchers()) + (await k.vouchers.reencryptCopies(true))
    : (await k.vouchers.reencryptNumbers()) + (await k.vouchers.reencryptCopies());
}

export type VoucherServices = ReturnType<typeof createVouchers>;
