/** Market price, price history and price alert of a set. */
import type { Viewer } from '../household';
import { normalizeSetNumber } from '../infra/setNumber';
import type { ConditionState } from '../infra/validate';
import type { CsvImportReport } from '../infra/csvExport';
import * as repo from './repository/setDetail';
import { attempts } from '../infra/result';
import type { SetsContext } from './context';

/** In the inventory's condition. null: no set in scope. */
export async function setPrice(sk: SetsContext, uid: number, scopeChoice: Viewer | number[], sn: string) {
  const scope = await sk.household.scopeFrom(scopeChoice);
  const set = await repo.setInField(sk.db, sn, scope);
  if (!set) return null;
  // The currency from the setting: the app sent its local start value before it knew
  // the setting.
  const currency = await currencyOf(sk, uid);
  const guideType = String(await sk.settings.userValue(uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await sk.settings.userValue(uid, 'price_cache_ttl', '24'));
  const price = await attempts('sets:preis', async () =>
    sk.finances.fetchPrice(sn, await sk.finances.setState(scope, sn), guideType, currency, ttlHours, null),
  );
  if (!price.ok)
    return {
      set_number: sn,
      currency,
      min_price: null,
      avg_price: null,
      max_price: null,
      qty_avg_price: null,
      no_price: true,
      error: price.error.reason,
    };
  const pd = price.value;
  return {
    set_number: sn,
    currency,
    min_price: pd.min_price,
    avg_price: pd.avg_price,
    max_price: pd.max_price,
    qty_avg_price: pd.qty_avg_price,
    from_cache: pd.from_cache,
    no_price: !!(pd as { no_price?: boolean }).no_price,
  };
}

/** The currency from the settings, not from the request: two sources
 * would drift apart at the next change. */
export async function currencyOf(sk: SetsContext, uid: number): Promise<string> {
  return String(await sk.settings.userValue(uid, 'currency', 'EUR'));
}

export function readSetAlerts(sk: SetsContext, uid: number, sn: string) {
  return sk.finances.priceAlert.alertsFor(uid, normalizeSetNumber(sn));
}

export async function setAlarmOfSets(
  sk: SetsContext,
  uid: number,
  sn: string,
  input: Parameters<SetsContext['finances']['priceAlert']['setAlert']>[3],
) {
  return sk.finances.priceAlert.setAlert(uid, normalizeSetNumber(sn), await currencyOf(sk, uid), input);
}

export function deleteAlarmOfSets(sk: SetsContext, uid: number, sn: string, condition: ConditionState | undefined) {
  return sk.finances.priceAlert.deleteAlert(uid, normalizeSetNumber(sn), condition ?? 'N');
}

export async function startAlarmCsvImport(sk: SetsContext, uid: number, text: string) {
  return sk.jobQueue.waitOnJob<CsvImportReport, 'csv_import'>(
    'csv_import',
    { user_id: uid, source: 'alarme_csv', eingabe: { currency: await currencyOf(sk, uid), text } },
    { userId: uid },
  );
}

export async function setPriceHistory(sk: SetsContext, uid: number, viewer: Viewer | number[], sn: string) {
  return sk.finances.priceHistorySet(viewer, sn, await currencyOf(sk, uid));
}
