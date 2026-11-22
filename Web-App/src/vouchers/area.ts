/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import * as service from './service';
import * as pdfTicket from './pdfTicket';
import { encryptLegacyVoucherFiles } from './voucherFiles';
import { access, type VoucherDependencies, type VoucherContext } from './context';

export type { VoucherDependencies, VoucherContext } from './context';

export function createVouchers(a: Omit<VoucherDependencies, 'faecher'>, inspect?: Inspect<VoucherContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    access,
    (k: VoucherContext) => ({
      changeVoucher: withValue(k)(service.changeVoucher),
      voucherPlaintext: withValue(k)(service.voucherPlaintext),
      releasePdf: withValue(k)(service.releasePdf),
      releaseExport: withValue(k)(service.releaseExport),
      checkBalance: withValue(k)(service.checkBalance),
      voucherList: withValue(k)(service.voucherList),
      createVoucher: withValue(k)(service.createVoucher),
      deleteVoucher: withValue(k)(service.deleteVoucher),
      voucherFromPdf: withValue(k)(service.voucherFromPdf),
      exportVouchers: withValue(k)(service.exportVouchers),
      voucherPdf: withValue(k)(service.voucherPdf),
      redeemTicket: withValue(k)(pdfTicket.redeemTicket),
      encryptLegacyFiles: encryptLegacyVoucherFiles,
      // Re-encrypting at startup (startup/database.ts): across all accounts, without a request.
      reencryptNumbers: k.vouchers.reencryptNumbers,
      reencryptCopies: k.vouchers.reencryptCopies,
      reencryptAllVouchers: k.vouchers.reencryptAllVouchers,
    }),
    inspect,
  );
}

export type VoucherServices = ReturnType<typeof createVouchers>;
