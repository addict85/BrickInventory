/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/area';
import * as balanceThrottle from './repository/balanceThrottle';
import * as vouchers from './repository/vouchers';
import type { SettingsServices } from '../settings';
import type { AccountServices } from '../account';
import type { ForeignSourcesServices } from '../externalSources';
import type { Faecher } from '../infra/cache';
import type { Uhr } from '../infra/clock';

export interface VoucherDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  account: AccountServices;
  throttle: ThrottleServices;
  externalSources: ForeignSourcesServices;
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
