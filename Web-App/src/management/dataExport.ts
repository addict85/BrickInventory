/** Backup of the settings (JSON) and the inventory data (ZIP with CSVs), plus
 * importing a settings file. The routes only pass through. */
import type { Writable } from 'node:stream';
import { SECRET_KEYS, isMasked, isValidGlobalValue } from '../settings';
import { DAILY_JOBS } from './timesOfDay';
import { rescheduleJobs } from './service';
import { jsonOrNull } from '../infra/validate';
import { fachfehler } from '../infra/errorTexts';
import { KonfigExport } from '../contract/settings';
import type { ManagementContext } from './context';

/** Mail server, registration and API keys are only accepted by the form, with password. */
export const isSensitive = (k: string) =>
  k.startsWith('smtp_') || k === 'registration_enabled' || /api_key$|^bricklink_(consumer|token)/.test(k);

/** Global values only for admins: the import only accepts them from them, and
 * SMTP data is none of a sub-account's business. */
export async function exportConfig(k: ManagementContext, uid: number, verwalter: boolean, name: string | null) {
  return {
    exported_at: k.uhr.datum().toISOString(),
    exported_by: name,
    version: '3.0',
    global: verwalter ? await k.settings.globalValuesWithoutSecrets() : {},
    user_settings: await k.settings.userSettings(uid),
  };
}

/** Everything in the same archive: the configuration exports cannot carry inventory data. */
export async function dataZip(
  k: ManagementContext,
  uid: number,
  ziel: Writable,
  atError: (e: Error) => void,
): Promise<void> {
  // archiver 8 is an ES module; from CommonJS only require() works, no import.
  const { ZipArchive } = require('archiver') as { ZipArchive: new (o: object) => ZipArchiveHandle };
  const [setsCsv, partsCsv, figsCsv, merkCsv, alarmCsv] = await Promise.all([
    k.sets.setsAlsCsv(uid),
    k.inventory.partsAsCsv(uid),
    k.inventory.minifigsAsCsv(uid),
    k.wanted.wantedListCsv(uid),
    k.finances.preisalarm.preisalarmeAlsCsv(uid),
  ]);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', atError);
  archive.pipe(ziel);
  for (const [name, inhalt] of [
    ['sets.csv', setsCsv],
    ['teile.csv', partsCsv],
    ['minifiguren.csv', figsCsv],
    ['merkliste.csv', merkCsv],
    ['preisalarme.csv', alarmCsv],
  ] as const)
    archive.append('﻿' + inhalt, { name });
  await archive.finalize();
}
interface ZipArchiveHandle {
  on(e: 'error', f: (e: Error) => void): void;
  pipe(z: Writable): void;
  append(inhalt: string, o: { name: string }): void;
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
  'gutschein_land',
  ...DAILY_JOBS.map(j => `job_time_${j.name}`),
].filter(k => !isSensitive(k));
const ACCOUNT_IMPORT = ['currency', 'user_default_condition'];

/** An import file comes from anywhere: schema (KonfigExport), rules per key
 * (GLOBAL_RULES) and without the sensitive keys that would need a confirmation. */
export async function importConfig(kx: ManagementContext, uid: number, verwalter: boolean, datei: Buffer) {
  const gelesen = jsonOrNull(datei.toString('utf-8'));
  const geprueft = gelesen ? KonfigExport.safeParse(gelesen.wert) : null;
  if (!geprueft?.success) fachfehler('ungueltig', 'json_ungueltig');
  const { global, user_settings: konto } = geprueft.data;
  let imported = 0;
  const smtpSkipped = global ? Object.keys(global).filter(isSensitive) : [];
  if (global && verwalter) {
    if (GLOBAL_IMPORT.some(k => global[k] !== undefined && !isValidGlobalValue(k, global[k])))
      fachfehler('ungueltig', 'wert_ungueltig');
    const geaendert: string[] = [];
    for (const key of GLOBAL_IMPORT.filter(k => global[k] !== undefined)) {
      // Masked values from older exports must not overwrite real keys.
      if (SECRET_KEYS.has(key) && isMasked(global[key])) continue;
      if (String(global[key]) !== String((await kx.settings.globalValue(key)) ?? '')) geaendert.push(key);
      await kx.settings.setGlobalValue(key, global[key]);
      imported++;
    }
    if (geaendert.length)
      await kx.account.verwalter.rememberAdminAction(
        uid,
        uid,
        'einstellungen_geaendert',
        `Import: ${geaendert.join(', ')}`,
      );
  }
  // Central place: an imported currency change triggers the price job.
  for (const key of ACCOUNT_IMPORT.filter(k => konto?.[k] !== undefined)) {
    await kx.settings.setUserSetting(uid, key, konto![key]);
    imported++;
  }
  // Only admins: otherwise every account could clear the price cache with a one-line file.
  if (verwalter) await rescheduleJobs(kx);
  const note =
    (verwalter ? 'Globale + Benutzer-Einstellungen importiert' : 'Nur Benutzer-Einstellungen importiert') +
    (verwalter && smtpSkipped.length
      ? '; Mailserver, Registrierung und API-Schlüssel nicht übernommen — bitte im Formular setzen'
      : '');
  return { imported, note, smtp_uebergangen: verwalter ? smtpSkipped : [] };
}
