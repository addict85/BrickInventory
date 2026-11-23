/** Backup of the settings (JSON) and the inventory data (ZIP with CSVs), plus
 * importing a settings file. The routes only pass through. */
import type { Writable } from 'node:stream';
import type { z } from 'zod';
import { SECRET_KEYS, isMasked, isValidGlobalValue } from '../settings';
import { DAILY_JOBS } from './timesOfDay';
import { rescheduleJobs } from './service';
import { jsonOrNull } from '../infra/validate';
import { failDomain } from '../infra/errorTexts';
import { ConfigExport } from '../contract/settings';
import type { ManagementContext } from './context';

/** Mail server, registration and API keys are only accepted by the form, with password. */
export const isSensitive = (k: string) =>
  k.startsWith('smtp_') || k === 'registration_enabled' || /api_key$|^bricklink_(consumer|token)/.test(k);

/** Global values only for admins: the import only accepts them from them, and
 * SMTP data is none of a sub-account's business. */
export async function exportConfig(k: ManagementContext, uid: number, admin: boolean, name: string | null) {
  return {
    exported_at: k.clock.date().toISOString(),
    exported_by: name,
    version: '3.0',
    global: admin ? await k.settings.globalValuesWithoutSecrets() : {},
    user_settings: await k.settings.userSettings(uid),
  };
}

/** Everything in the same archive: the configuration exports cannot carry inventory data. */
export async function dataZip(
  k: ManagementContext,
  uid: number,
  target: Writable,
  atError: (e: Error) => void,
): Promise<void> {
  // archiver 8 is an ES module; from CommonJS only require() works, no import.
  const { ZipArchive } = require('archiver') as { ZipArchive: new (o: object) => ZipArchiveHandle };
  const [setsCsv, partsCsv, figsCsv, noteCsv, alarmCsv] = await Promise.all([
    k.sets.setsAsCsv(uid),
    k.inventory.partsAsCsv(uid),
    k.inventory.minifigsAsCsv(uid),
    k.wanted.wantedListCsv(uid),
    k.finances.priceAlert.priceAlertsAsCsv(uid),
  ]);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', atError);
  archive.pipe(target);
  for (const [name, content] of [
    ['sets.csv', setsCsv],
    ['teile.csv', partsCsv],
    ['minifiguren.csv', figsCsv],
    ['merkliste.csv', noteCsv],
    ['preisalarme.csv', alarmCsv],
  ] as const)
    archive.append('﻿' + content, { name });
  await archive.finalize();
}
interface ZipArchiveHandle {
  on(e: 'error', f: (e: Error) => void): void;
  pipe(z: Writable): void;
  append(content: string, o: { name: string }): void;
  finalize(): Promise<void>;
}

const GLOBAL_IMPORT = [
  'bricklink_consumer_key',
  'bricklink_consumer_secret',
  'bricklink_token',
  'bricklink_token_secret',
  'brickset_api_key',
  'rebrickable_api_key',
  'price_job_interval_minutes',
  'price_cache_ttl',
  'api_limit_rebrickable',
  'api_limit_bricklink',
  'api_limit_brickset',
  'registration_enabled',
  'default_price_condition',
  'voucher_country',
  ...DAILY_JOBS.map(j => `job_time_${j.name}`),
].filter(k => !isSensitive(k));
const ACCOUNT_IMPORT = ['currency', 'user_default_condition'];

/** An import file comes from anywhere: schema (KonfigExport), rules per key
 * (GLOBAL_RULES) and without the sensitive keys that would need a confirmation. */
type GlobalImport = NonNullable<z.output<typeof ConfigExport>['global']>;

/** Exports before migration 0137 name the voucher country in German. */
function withVoucherCountry(raw: GlobalImport | undefined): GlobalImport | undefined {
  return raw && 'gutschein_land' in raw && !('voucher_country' in raw)
    ? { ...raw, voucher_country: raw.gutschein_land }
    : raw;
}

/** All or nothing for invalid values; @returns how many were written. */
async function importGlobal(kx: ManagementContext, uid: number, global: GlobalImport): Promise<number> {
  if (GLOBAL_IMPORT.some(k => global[k] !== undefined && !isValidGlobalValue(k, global[k])))
    failDomain('invalid', 'value_invalid');
  const changed: string[] = [];
  let imported = 0;
  for (const key of GLOBAL_IMPORT.filter(k => global[k] !== undefined)) {
    // Masked values from older exports must not overwrite real keys.
    if (SECRET_KEYS.has(key) && isMasked(global[key])) continue;
    if (String(global[key]) !== String((await kx.settings.globalValue(key)) ?? '')) changed.push(key);
    await kx.settings.setGlobalValue(key, global[key]);
    imported++;
  }
  if (changed.length)
    await kx.account.admin.rememberAdminAction(uid, uid, 'settings_changed', `Import: ${changed.join(', ')}`);
  return imported;
}

export async function importConfig(kx: ManagementContext, uid: number, admin: boolean, file: Buffer) {
  const read = jsonOrNull(file.toString('utf-8'));
  const checked = read ? ConfigExport.safeParse(read.value) : null;
  if (!checked?.success) failDomain('invalid', 'json_invalid');
  const { global: raw, user_settings: account } = checked.data;
  const global = withVoucherCountry(raw);
  let imported = 0;
  const smtpSkipped = global ? Object.keys(global).filter(isSensitive) : [];
  if (global && admin) imported += await importGlobal(kx, uid, global);
  // Central place: an imported currency change triggers the price job.
  for (const key of ACCOUNT_IMPORT.filter(k => account?.[k] !== undefined)) {
    await kx.settings.setUserSetting(uid, key, account![key]);
    imported++;
  }
  // Only admins: otherwise every account could clear the price cache with a one-line file.
  if (admin) await rescheduleJobs(kx);
  if (!admin) return { imported, note: 'Nur Benutzer-Einstellungen importiert', smtp_skipped: [] };
  const note =
    'Globale + Benutzer-Einstellungen importiert' +
    (smtpSkipped.length
      ? '; Mailserver, Registrierung und API-Schlüssel nicht übernommen — bitte im Formular setzen'
      : '');
  return { imported, note, smtp_skipped: smtpSkipped };
}
