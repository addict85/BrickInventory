/** POST /settings without HTTP. Here instead of in src/settings, because mail, log
 * and Brickset queue are higher levels (test/layers.test.js). */
import { SECRET_KEYS, isMasked, isValidGlobalValue } from '../settings';
import { failDomain } from '../infra/errorTexts';
import { inSystemContext } from '../infra/accountContext';
import { GLOBAL_SETTINGS, ACCOUNT_SETTINGS } from '../contract/settings';
import type { Input } from '../contract';
import { isSensitive } from './dataExport';
import { bricksetLimitSet } from './service';
import type { ManagementContext } from './context';

type SettingsInput = Input<'POST /api/v2/settings'>;

export interface SaveSettingsOptions {
  uid: number;
  name: string;
  /** Admin, and an app token already has the approval (route). */
  admin: boolean;
}

/** Whether an admin part is present: only then does an app token need the approval. */
export const hasGlobalValues = (e: SettingsInput) => GLOBAL_SETTINGS.some(k => e[k] !== undefined);

/** The changed sensitive keys (mail server, registration, API keys): they redirect
 * reset mails or open registration, so the administrators get a hint below. A first
 * API key redirects nothing; neither does the setup wizard's first entry. */
async function sensitiveKeys(k: ManagementContext, e: SettingsInput): Promise<string[]> {
  const sensitive: string[] = [];
  const setup = !(await k.settings.globalValue('einrichtung_erledigt'));
  for (const key of GLOBAL_SETTINGS.filter(isSensitive)) {
    const fresh = e[key];
    if (fresh === undefined || (SECRET_KEYS.has(key) && isMasked(fresh))) continue;
    const alt = String((await k.settings.globalValue(key)) ?? '');
    if (String(fresh) === alt || (setup && alt === '' && !key.startsWith('smtp_') && key !== 'registration_enabled'))
      continue;
    sensitive.push(key);
  }
  return sensitive;
}

/** A mask sent back unchanged is not a new value, otherwise every save would
 * overwrite the real keys with dots. */
async function writeGlobal(kx: ManagementContext, uid: number, e: SettingsInput): Promise<void> {
  const changed: string[] = [];
  for (const key of GLOBAL_SETTINGS) {
    if (e[key] === undefined || (SECRET_KEYS.has(key) && isMasked(e[key]))) continue;
    if (String(e[key]) !== String((await kx.settings.globalValue(key)) ?? '')) changed.push(key);
    await kx.settings.setGlobalValue(key, e[key]);
  }
  if (changed.length) await kx.account.admin.rememberAdminAction(uid, uid, 'settings_changed', changed.join(', '));
  // Whoever saved the mail form has seen the hint about the old exception.
  if (GLOBAL_SETTINGS.some(k => k.startsWith('smtp_') && e[k] !== undefined))
    await kx.settings.deleteGlobalValues('smtp_insecure_tls');
}

/** All writes including the log in one transaction: if one value fails,
 * none of the others is left half saved. */
export async function saveSettings(kx: ManagementContext, e: SettingsInput, o: SaveSettingsOptions): Promise<void> {
  const global = o.admin && hasGlobalValues(e);
  if (global) {
    if (GLOBAL_SETTINGS.some(k => e[k] !== undefined && !isValidGlobalValue(k, e[k])))
      failDomain('invalid', 'value_invalid');
    if (
      String(e.registration_enabled) === '1' &&
      (await kx.settings.globalValue('registration_enabled')) !== '1' &&
      !(await kx.mail.mailReady(e))
    )
      failDomain('invalid', 'registration_needs_mail');
  }
  const sensitive = global ? await sensitiveKeys(kx, e) : [];

  // The currency applies to the whole household and therefore needs the system frame, which
  // cannot be entered within a transaction: beforehand and on its own. If it fails,
  // nothing has been written yet; the price job only follows a real change.
  if (e.currency !== undefined) await kx.settings.setUserSetting(o.uid, 'currency', e.currency);
  // Global values are only written by the system role (0117): then the whole transaction in its frame.
  const frame = <T>(f: () => Promise<T>) => (global ? inSystemContext('globale Einstellungen', f) : f());
  const bricksetAlt = await frame(() =>
    kx.transact(async t => {
      const alt =
        global && e.api_limit_brickset !== undefined
          ? parseInt((await t.settings.globalValue('api_limit_brickset')) || '100', 10)
          : null;
      if (global) await writeGlobal(t, o.uid, e);
      for (const key of ACCOUNT_SETTINGS)
        if (key !== 'currency' && e[key] !== undefined) await t.settings.setUserSetting(o.uid, key, e[key]);
      return alt;
    }),
  );
  if (!global) return;
  // Only after the COMMIT: a cache would otherwise still read the old value.
  await kx.settings.notifyGlobalChange();
  if (sensitive.some(k => !k.startsWith('smtp_')))
    kx.account.adminHintInBackground('settings_changed', { account: sensitive.join(', '), actor: o.name });
  if (bricksetAlt !== null) await bricksetLimitSet(kx, bricksetAlt, parseInt(String(e.api_limit_brickset), 10));
}
