import { sperreHaushaltswaehrung } from '../../db/txLock';
import { fachfehler } from '../infra/fehlerTexte';
import { imSystemkontext } from '../infra/kontoKontext';
import { ereignis } from '../infra/ereignis';
import { isValidUserValue, writeUserSetting } from './settings';
import * as repo from './repository/currency';
import type { SettingsContext } from './context';

const currencyChange = (k: SettingsContext) => k.faecher.fach('currencyChange', () => ereignis('currencyChange'));
/** Finances sit above and listen themselves (createFinances): settings does not know them. */
export function onCurrencyChange(k: SettingsContext, fn: () => unknown): () => void {
  return currencyChange(k).horche(fn);
}

/** The one write site: a currency change must trigger the price job,
 * because the price cache is encrypted per currency. */
export async function setUserSetting(k: SettingsContext, userId: number, key: string, value: unknown) {
  if (key !== 'currency') return writeUserSetting(k, userId, key, value);
  const v = String(value).trim();
  if (!isValidUserValue(key, v)) fachfehler('ungueltig', 'wert_ungueltig');
  return setHouseholdCurrency(k, userId, v);
}

/** Afterwards the installation's default applies. */
export async function deleteUserSetting(k: SettingsContext, userId: number, key: string) {
  await k.repository.deleteUserValue(userId, key);
}

/** For the whole household, otherwise two currencies would give a wrong total; einladungEinloesen() locks the same way. */
async function setHouseholdCurrency(k: SettingsContext, userId: number, currency: string) {
  // Over grandchildren and foreign main accounts (sharedWithForeignMain): further than the row guard reaches.
  const before = await imSystemkontext('haushaltswaehrung', () =>
    k.transaktion(async t => {
      await sperreHaushaltswaehrung(t.db);
      const old = await repo.currencyOf(t.db, userId);
      const subAccount = await repo.hasMainAccount(t.db, t.lesevertrag, userId);
      if (old !== currency) {
        if (subAccount) fachfehler('verboten', 'waehrung_nur_hauptkonto');
        // Every change triggers a full price run.
        const rate = await t.throttle.countInWindow(`waehrung|konto:${userId}`, 60);
        if (rate.count > 5) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: rate.waitMin });
      }
      if (subAccount) return old;
      const household = await repo.ownHousehold(t.db, t.lesevertrag, userId);
      if ((await repo.sharedWithForeignMain(t.db, t.lesevertrag, household, currency)).length) {
        if (old !== currency) fachfehler('konflikt', 'waehrung_geteiltes_unterkonto');
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
    setImmediate(() => void currencyChange(k).melde());
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
