/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import { withValue, type Context } from '../infra/area';
import * as balanceThrottle from './repository/balanceThrottle';
import * as vouchers from './repository/vouchers';
import type { SettingsServices } from '../settings';
import type { AccountServices } from '../account';
import type { ForeignSourcesServices } from '../externalSources';
import type { Faecher } from '../infra/cache';
import type { Clock } from '../infra/clock';

export interface VoucherDependencies {
  uhr: Clock;
  db: Db;
  einstellungen: SettingsServices;
  account: AccountServices;
  throttle: ThrottleServices;
  externalSources: ForeignSourcesServices;
  /** Sessions of balance lookups and PDF tickets of this set of services. */
  faecher: Faecher;
}

export const access = (db: Db) => ({
  balanceThrottle: {
    openThrottle: withValue(db)(balanceThrottle.openThrottle),
    lockThrottle: withValue(db)(balanceThrottle.lockThrottle),
  },
  vouchers: {
    rememberBalance: withValue(db)(vouchers.rememberBalance),
    voucher: withValue(db)(vouchers.voucher),
    changeVoucher: withValue(db)(vouchers.updateVoucher),
    createVoucher: withValue(db)(vouchers.insertVoucher),
    replaceVoucher: withValue(db)(vouchers.replaceVoucher),
    lockedVoucher: withValue(db)(vouchers.lockedVoucher),
    deleteVoucher: withValue(db)(vouchers.removeVoucher),
    rememberVoucherPdf: withValue(db)(vouchers.rememberVoucherPdf),
    vouchersOfAccount: withValue(db)(vouchers.vouchersOfAccount),
    reencryptAllVouchers: withValue(db)(vouchers.reencryptAllVouchers),
    reencryptCopies: withValue(db)(vouchers.reencryptCopies),
    reencryptNumbers: withValue(db)(vouchers.reencryptNumbers),
  },
});
export type VoucherContext = Context<VoucherDependencies, ReturnType<typeof access>>;
