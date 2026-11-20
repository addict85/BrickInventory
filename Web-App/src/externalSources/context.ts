/** Einstellungen für die Schlüssel, Aufträge für die Brickset-Wiedervorlage. Getrennt von
 * bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import { mit, type Kontext } from '../infra/bereich';
import type { Db } from '../../db/database';
import type { JobsServices } from '../auftraege';
import type { SettingsServices } from '../settings';
import * as apiKontingent from './repository/apiQuota';
import * as apiTakt from './repository/apiTick';
import type { Quellen } from './sources';
import type { Uhr } from '../infra/uhr';

export interface ForeignSourcesDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: SettingsServices;
  auftraege: JobsServices;
  /** Was ein Test statt der echten Klienten gibt; gelesen beim Aufruf (bereich.ts). */
  ersatz?: Partial<Quellen> | undefined;
}

export const zugang = (db: Db) => ({
  apiKontingent: {
    countApiCall: mit(db)(apiKontingent.countApiCall),
    callsToday: mit(db)(apiKontingent.callsToday),
    callsJeAccount: mit(db)(apiKontingent.callsJeAccount),
    setApiCounterBack: mit(db)(apiKontingent.setApiCounterBack),
  },
  apiTakt: {
    receiptsTick: mit(db)(apiTakt.receiptsTick),
    pushTick: mit(db)(apiTakt.pushTick),
  },
});
export type ForeignSourcesContext = Kontext<ForeignSourcesDependencies, ReturnType<typeof zugang>>;
