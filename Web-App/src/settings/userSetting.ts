import { lockHouseholdCurrency } from '../../db/txLock';
import { failDomain } from '../infra/errorTexts';
import { inSystemContext } from '../infra/accountContext';
import { event } from '../infra/event';
import { isValidUserValue, writeUserSetting } from './settings';
import * as repo from './repository/currency';
import type { SettingsContext } from './context';

const currencyChange = (k: SettingsContext) => k.faecher.slot('currencyChange', () => event('currencyChange'));
/** Finances sit above and listen themselves (createFinances): settings does not know them. */
export function onCurrencyChange(k: SettingsContext, fn: () => unknown): () => void {
  return currencyChange(k).listen(fn);
}

/** The one write site: a currency change must trigger the price job,
 * because the price cache is encrypted per currency. */
export async function setUserSetting(k: SettingsContext, userId: number, key: string, value: unknown) {
  if (key !== 'currency') return writeUserSetting(k, userId, key, value);
  const v = String(value).trim();
  if (!isValidUserValue(key, v)) failDomain('ungueltig', 'value_invalid');
  return setHouseholdCurrency(k, userId, v);
}

/** Afterwards the installation's default applies. */
export async function deleteUserSetting(k: SettingsContext, userId: number, key: string) {
  await k.repository.deleteUserValue(userId, key);
}

/** For the whole household, otherwise two currencies would give a wrong total; redeemInvitation() locks the same way. */
async function setHouseholdCurrency(k: SettingsContext, userId: number, currency: string) {
  // Over grandchildren and foreign main accounts (sharedWithForeignMain): further than the row guard reaches.
  const before = await inSystemContext('haushaltswaehrung', () =>
    k.transact(async t => {
      await lockHouseholdCurrency(t.db);
      const old = await repo.storedCurrencyOf(t.db, userId);
      const subAccount = await repo.hasMainAccount(t.db, t.readContract, userId);
      if (old !== currency) {
        if (subAccount) failDomain('verboten', 'currency_main_account_only');
        // Every change triggers a full price run.
        const rate = await t.throttle.countInWindow(`waehrung|konto:${userId}`, 60);
        if (rate.count > 5) failDomain('zu_viele', 'too_many_requests', { minutes: rate.waitMin });
      }
      if (subAccount) return old;
      const household = await repo.ownHousehold(t.db, t.readContract, userId);
      if ((await repo.sharedWithForeignMain(t.db, t.readContract, household, currency)).length) {
        if (old !== currency) failDomain('konflikt', 'currency_shared_sub_account');
        return old;
      }
      await repo.setCurrencyFor(t.db, household, currency);
      return old;
    }),
  );
  if (before !== currency) {
    console.log(
      `[settings] Currency changed for user ${userId} and their household (${before ?? '—'} → ${currency}) — triggering price job`,
    );
    setImmediate(() => void currencyChange(k).report());
  }
}

export async function setOwnTheme(k: SettingsContext, userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) {
    await deleteUserSetting(k, userId, 'app_theme');
    return;
  }
  await setUserSetting(k, userId, 'app_theme', v);
}
