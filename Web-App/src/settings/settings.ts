import { verschluessele, entschluessele, umschluesseln, kontext } from '../infra/geheimnis';
import { fachfehler, dateiFehler } from '../infra/fehlerTexte';
import { GLOBALE_REGELN, DESIGNS, type GlobalerSchluessel } from '../vertrag/globaleRegeln';
import * as repo from './repository/values';
import type { DbSchnittstelle } from '../../db/database';
import type { SettingsContext } from './context';
import { prozessEreignis } from '../infra/ereignis';

/** Stored as text; with a fallback the result is text or the fallback, never `any`. */
export async function getSetting(k: SettingsContext, userId: number, key: string): Promise<string | null | undefined>;
export async function getSetting<T>(k: SettingsContext, userId: number, key: string, fallback: T): Promise<string | T>;
export async function getSetting(
  k: SettingsContext,
  userId: number,
  key: string,
  fallback?: unknown,
): Promise<unknown> {
  return (await settingWithAccess(k.db, userId, key)) || fallback;
}

/** getSetting over a passed-in access, for areas with their own context (src/sets). */
export async function settingWithAccess(
  db: DbSchnittstelle,
  userId: number,
  key: string,
  fallback?: string,
): Promise<string | null | undefined> {
  const own = await repo.userValue(db, userId, key);
  if (own) return own;
  return reveal(key, await repo.globalValue(db, key)) || fallback;
}

/** Secret values sit encrypted (src/infra/geheimnis.ts). */
function reveal(key: string, value: string | null | undefined): string | null | undefined {
  return SECRET_KEYS.has(key) ? entschluessele(value, globalContext(key)) : value;
}

/** The name in the context: an SMTP password copied into an API key's row stays unreadable. */
const globalContext = (key: string) => kontext('global_settings.value', key);

export async function getGlobalSetting(k: SettingsContext, key: string): Promise<string | null>;
export async function getGlobalSetting<T>(k: SettingsContext, key: string, fallback: T): Promise<string | T>;
// The fallback applies to "not set", not to "not readable": otherwise a database error
// would look like a missing key or a default value.
export async function getGlobalSetting(k: SettingsContext, key: string, fallback: unknown = null): Promise<unknown> {
  return reveal(key, await k.repository.globalValue(key)) ?? fallback;
}

// What an account may set itself: these values land in pages, PDFs and
// price lookups; "XYZ" as a currency would silently null out every valuation.
export const CURRENCIES = new Set(['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK']);
export { DESIGNS };
const USER_RULES: Record<string, (v: string) => boolean> = {
  currency: v => CURRENCIES.has(v),
  language: v => v === 'de' || v === 'en',
  user_default_condition: v => v === 'N' || v === 'U' || v === '',
  price_cache_ttl: v => /^\d{1,4}$/.test(v) && +v >= 1 && +v <= 8760,
  app_theme: v => DESIGNS.includes(v),
};

/** Validates and writes; currency applies per household and therefore only
 * goes through setUserSetting (userSetting.ts). */
export async function writeUserSetting(k: SettingsContext, userId: number, key: string, value: unknown): Promise<void> {
  const v = String(value).trim();
  if (key === 'currency') throw new Error('Currency only via setUserSetting');
  const rule = USER_RULES[key];
  if (rule && !rule(v)) fachfehler('ungueltig', 'wert_ungueltig');
  await k.repository.writeUserValue(userId, key, v);
}

export function isValidUserValue(key: string, value: string): boolean {
  return USER_RULES[key]?.(value) ?? true;
}

/** Own value → global default → 'N'; one place instead of three versions. */
export async function userDefaultCondition(k: SettingsContext, userId: number): Promise<'N' | 'U'> {
  const own = await k.repository.userValue(userId, 'user_default_condition');
  if (own === 'N' || own === 'U') return own;
  return globalDefaultCondition(k);
}

/** Input → stock → default; one place, so a used part never gets the new price.
 * @param input Anything other than 'N'/'U' counts as nothing. */
export async function conditionForPrice(
  k: SettingsContext,
  input: unknown,
  previous: string | null | undefined,
  userId: number,
): Promise<string> {
  if (input === 'N' || input === 'U') return input;
  if (previous) return previous;
  return userDefaultCondition(k, userId);
}

export async function globalDefaultCondition(k: SettingsContext): Promise<'N' | 'U'> {
  const g = await k.repository.globalValue('default_price_condition');
  return g === 'U' ? 'U' : 'N';
}

const ruleFor = (key: string) =>
  Object.hasOwn(GLOBALE_REGELN, key) ? GLOBALE_REGELN[key as GlobalerSchluessel] : undefined;

export function isValidGlobalValue(key: string, value: unknown): boolean {
  return ruleFor(key)?.safeParse(value).success ?? false;
}

/** Over NOTIFY: the job process and every other web process also write global values. */
const globalChange = (k: SettingsContext) =>
  k.faecher.fach('globalChange', () => prozessEreignis('globalChange', 'globale_einstellung'));
/** For caches computed from global values: they clear themselves instead of every
 * write site having to know about them. */
export function onGlobalChange(k: SettingsContext, fn: () => void): () => void {
  return globalChange(k).horche(fn);
}

/** From now on, a change in another process also clears the caches here. */
export function listenForGlobalChanges(k: SettingsContext): () => void {
  return globalChange(k).verbinde(k.db.benachrichtigung);
}

/** THE ONE write site; every key needs a rule in GLOBALE_REGELN. */
export async function setGlobalSetting(k: SettingsContext, key: string, value: unknown) {
  const r = ruleFor(key)?.safeParse(value);
  if (!r?.success)
    throw (
      (r?.error.issues[0] as { params?: { fehler?: unknown } } | undefined)?.params?.fehler ??
      dateiFehler('ungueltig', 'wert_ungueltig')
    );
  await k.repository.writeGlobalValue(key, SECRET_KEYS.has(key) ? verschluessele(r.data, globalContext(key)) : r.data);
  await notifyGlobalChange(k);
}

/** Also after a transaction COMMITs: a cache that read in between would keep the old value. */
export async function notifyGlobalChange(k: SettingsContext): Promise<void> {
  await globalChange(k).melde(k.db.benachrichtigung);
}

/** Open only at exactly '1'; a missing row stays closed. */
export async function registrationOpen(k: SettingsContext): Promise<boolean> {
  return (await getGlobalSetting(k, 'registration_enabled')) === '1';
}

/** `AND value = $3`: if another process has since written the row again, it stays as it is. */
export async function reencryptLegacyGlobalValues(k: SettingsContext): Promise<number> {
  let n = 0;
  for (const z of await k.repository.globalValues([...SECRET_KEYS])) {
    const neu = umschluesseln(z.value, globalContext(z.key));
    if (neu && (await k.repository.replaceGlobalValue(z.key, z.value, neu))) n++;
  }
  return n;
}

/** "Missing" is different from "empty". */
export async function deleteGlobalValues(k: SettingsContext, ...keys: string[]) {
  if (keys.length === 0) return;
  await k.repository.deleteGlobalValues(keys);
}

// READING settings — one version for both front ends, so the apps behave alike.

/** Never delivered in plain text. */
export const SECRET_KEYS = new Set([
  'bricklink_consumer_key',
  'bricklink_consumer_secret',
  'bricklink_token',
  'bricklink_token_secret',
  'brickset_api_key',
  'rebrickable_api_key',
  'smtp_pass',
]);

/** Not a secret, but the administrator's business: mail server and account reveal
 * where the reset mails go. */
const ADMIN_ONLY = /^smtp_/;

/** Does not occur in real keys. */
const MASK_CHAR = '•';

/** Not a single character of the value travels along: even the last four would narrow
 * guessing and reveal whether two installations share one. */
export function secretMask(value: string | null | undefined) {
  return String(value ?? '') ? MASK_CHAR.repeat(12) : '';
}

export function isMasked(value: unknown) {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

/** Non-administrators don't see the keys, administrators see them masked. */
export function globalValuesForView(global: Record<string, unknown>, isAdmin: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(global)) {
    if (SECRET_KEYS.has(k)) {
      if (isAdmin) out[k] = secretMask(v as string | null | undefined);
      continue;
    }
    if (!isAdmin && ADMIN_ONLY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function userSettings(k: SettingsContext, userId: number) {
  return Object.fromEntries((await k.repository.userValues(userId)).map(r => [r.key, r.value]));
}

export async function readSettings(k: SettingsContext, userId: number, isAdmin: boolean) {
  const raw = Object.fromEntries((await k.repository.globalValues()).map(r => [r.key, reveal(r.key, r.value)]));
  return { ...globalValuesForView(raw, !!isAdmin), ...(await userSettings(k, userId)) };
}

/** Without secrets: the file is passed on; keys are re-entered when restoring. */
export async function globalValuesWithoutSecrets(k: SettingsContext): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of await k.repository.globalValues()) if (!SECRET_KEYS.has(r.key)) out[r.key] = r.value;
  return out;
}

// ── Theme per account ────────────────────────────────────────────────────────
// Without its own row, the administrator's default applies — so everyone who
// has not chosen one follows a change.
export async function themeFor(
  k: SettingsContext,
  userId?: number | null,
): Promise<{ theme: string; vorgabe: string; eigenes: string | null }> {
  const g = await getGlobalSetting(k, 'app_theme');
  const vorgabe = g && DESIGNS.includes(g) ? g : 'classic';
  const u = userId ? await k.repository.userValue(userId, 'app_theme') : null;
  const eigenes = u && DESIGNS.includes(u) ? u : null;
  return { theme: eigenes ?? vorgabe, vorgabe, eigenes };
}
