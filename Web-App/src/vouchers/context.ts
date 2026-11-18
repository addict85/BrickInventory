/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as balanceThrottle from './repository/balanceThrottle';
import * as vouchers from './repository/vouchers';
import type { EinstellungenDienste } from '../einstellungen';
import type { KontoDienste } from '../konto';
import type { FremdquellenDienste } from '../fremdquellen';
import type { Faecher } from '../infra/zwischenspeicher';
import type { Uhr } from '../infra/uhr';

export interface VoucherDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: EinstellungenDienste;
  konto: KontoDienste;
  throttle: ThrottleServices;
  fremdquellen: FremdquellenDienste;
  /** Sessions of balance lookups and PDF tickets of this set of services. */
  faecher: Faecher;
}

export const zugang = (db: Db) => ({
  balanceThrottle: {
    openThrottle: mit(db)(balanceThrottle.openThrottle),
    lockThrottle: mit(db)(balanceThrottle.lockThrottle),
  },
  vouchers: {
    rememberBalance: mit(db)(vouchers.rememberBalance),
    voucher: mit(db)(vouchers.voucher),
    changeVoucher: mit(db)(vouchers.updateVoucher),
    createVoucher: mit(db)(vouchers.insertVoucher),
    replaceVoucher: mit(db)(vouchers.replaceVoucher),
    lockedVoucher: mit(db)(vouchers.lockedVoucher),
    deleteVoucher: mit(db)(vouchers.removeVoucher),
    rememberVoucherPdf: mit(db)(vouchers.rememberVoucherPdf),
    vouchersOfAccount: mit(db)(vouchers.vouchersOfAccount),
    reencryptAllVouchers: mit(db)(vouchers.reencryptAllVouchers),
    reencryptCopies: mit(db)(vouchers.reencryptCopies),
    reencryptNumbers: mit(db)(vouchers.reencryptNumbers),
  },
});
export type VoucherContext = Kontext<VoucherDependencies, ReturnType<typeof zugang>>;
