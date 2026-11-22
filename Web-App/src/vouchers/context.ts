/** What the services get; kept apart from area.ts so no import cycle forms. */
import type { ThrottleServices } from '../throttle';
import type { Db } from '../../db/database';
import { bound, type Context } from '../infra/area';
import * as balanceThrottle from './repository/balanceThrottle';
import * as vouchers from './repository/vouchers';
import * as pdfTickets from './repository/pdfTickets';
import type { SettingsServices } from '../settings';
import type { AccountServices } from '../account';
import type { ForeignSourcesServices } from '../externalSources';
import type { Compartments } from '../infra/cache';
import type { Clock } from '../infra/clock';

export interface VoucherDependencies {
  clock: Clock;
  db: Db;
  settings: SettingsServices;
  account: AccountServices;
  throttle: ThrottleServices;
  externalSources: ForeignSourcesServices;
  /** Sessions of balance lookups of this set of services. */
  compartments: Compartments;
}

export const access = (db: Db) => ({
  balanceThrottle: {
    openThrottle: bound(db)(balanceThrottle.openThrottle),
    lockThrottle: bound(db)(balanceThrottle.lockThrottle),
  },
  vouchers: {
    rememberBalance: bound(db)(vouchers.rememberBalance),
    voucher: bound(db)(vouchers.voucher),
    changeVoucher: bound(db)(vouchers.updateVoucher),
    createVoucher: bound(db)(vouchers.insertVoucher),
    replaceVoucher: bound(db)(vouchers.replaceVoucher),
    lockedVoucher: bound(db)(vouchers.lockedVoucher),
    deleteVoucher: bound(db)(vouchers.removeVoucher),
    rememberVoucherPdf: bound(db)(vouchers.rememberVoucherPdf),
    vouchersOfAccount: bound(db)(vouchers.vouchersOfAccount),
    reencryptAllVouchers: bound(db)(vouchers.reencryptAllVouchers),
    reencryptCopies: bound(db)(vouchers.reencryptCopies),
    reencryptNumbers: bound(db)(vouchers.reencryptNumbers),
  },
  pdfTickets: {
    insert: bound(db)(pdfTickets.insertTicket),
    take: bound(db)(pdfTickets.takeTicket),
    deleteExpired: bound(db)(pdfTickets.deleteExpiredTickets),
  },
});
export type VoucherContext = Context<VoucherDependencies, ReturnType<typeof access>>;
