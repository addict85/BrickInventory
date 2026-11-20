/** The area's factory: services as a closure over k (buildArea, src/infra/bereich.ts). */
import { mit, buildArea, type Inspect } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as service from './service';
import * as pdfTicket from './pdfTicket';
import { encryptLegacyVoucherFiles } from './voucherFiles';
import { zugang, type VoucherDependencies, type VoucherContext } from './context';

export type { VoucherDependencies, VoucherContext } from './context';

export function createVouchers(a: Omit<VoucherDependencies, 'faecher'>, inspect?: Inspect<VoucherContext>) {
  return buildArea(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: VoucherContext) => ({
      changeVoucher: mit(k)(service.changeVoucher),
      voucherPlaintext: mit(k)(service.voucherPlaintext),
      releasePdf: mit(k)(service.releasePdf),
      releaseExport: mit(k)(service.releaseExport),
      checkBalance: mit(k)(service.checkBalance),
      voucherList: mit(k)(service.voucherList),
      createVoucher: mit(k)(service.createVoucher),
      deleteVoucher: mit(k)(service.deleteVoucher),
      voucherFromPdf: mit(k)(service.voucherFromPdf),
      exportVouchers: mit(k)(service.exportVouchers),
      voucherPdf: mit(k)(service.voucherPdf),
      redeemTicket: mit(k)(pdfTicket.redeemTicket),
      encryptLegacyFiles: encryptLegacyVoucherFiles,
      // Re-encrypting at startup (startup/datenbank.ts): across all accounts, without a request.
      reencryptNumbers: k.vouchers.reencryptNumbers,
      reencryptCopies: k.vouchers.reencryptCopies,
      reencryptAllVouchers: k.vouchers.reencryptAllVouchers,
    }),
    inspect,
  );
}

export type VoucherServices = ReturnType<typeof createVouchers>;
