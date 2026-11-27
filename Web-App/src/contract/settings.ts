import { z } from 'zod';
import { V1_SETTING_KEYS } from './v1Names';
import { v1Keys, v1Values } from './v1';
import { AdminCondition, AdminTheme } from './management';
import {
  type Route,
  Success,
  whole,
  time,
  legacyConfirmation,
  WITHOUT_BODY,
  TEXT,
  CONDITION,
  SETTINGS,
  SIMPLE,
} from './base';
import { GLOBAL_RULES } from './globalRules';

/** What POST /settings accepts: global only from the admin, per account from everyone. */
export const GLOBAL_SETTINGS = [
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
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_secure',
  'smtp_tls_fingerprint',
  'smtp_tls_ca',
  'default_price_condition',
  'voucher_country',
] as const;
export const ACCOUNT_SETTINGS = ['currency', 'language', 'user_default_condition', 'remove_empty_vouchers'] as const;
type Setting = (typeof GLOBAL_SETTINGS)[number] | (typeof ACCOUNT_SETTINGS)[number];
const settingFields = Object.fromEntries(
  [...GLOBAL_SETTINGS, ...ACCOUNT_SETTINGS].map(k => [k, SIMPLE.optional()]),
) as Record<Setting, z.ZodOptional<typeof SIMPLE>>;
import { DEGRADED, GenericResponse } from './shared';

export const AppThemeResponse = z.looseObject({
  success: z.boolean(),
  theme: z.string(),
  preset: z.string().nullable(),
  own: z.string().nullable(),
});

export const DefaultConditionResponse = z.looseObject({
  success: z.boolean(),
  condition: z.string(),
});

export const UserSettings = z.looseObject({
  currency: z.string(),
  price_condition: z.string(),
  price_cache_ttl: z.string(),
  default_price_condition: z.string(),
  user_default_condition: z.string().nullable(),
  effective_condition: z.string(),
  app_theme: z.string(),
  remove_empty_vouchers: z.boolean(),
});

export const SettingsResponse = z.looseObject({
  success: z.boolean(),
  settings: UserSettings,
});

export const StartupStatus = z.looseObject({
  error: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  ready: z.boolean(),
  step: z.string().nullable(),
  // Completed steps plus the share of the running one (2.37 = step 3 at 37 %).
  progress: z.number().nonnegative(),
  total: z.number().int(),
  sub: z.string().nullable(),
});

export const Setup = z.looseObject({
  success: z.literal(true),
  open: z.boolean(),
  change_password: z.boolean(),
  sources: z.looseObject({ rebrickable: z.boolean(), bricklink: z.boolean(), brickset: z.boolean() }),
});
/** State of the initial setup for the login page: switches and the public
 * root certificate, no accounts and no keys. */
export const SetupState = z.looseObject({
  success: z.literal(true),
  done: z.boolean(),
  configured: z.boolean(),
  steps: z.array(
    z.looseObject({
      id: v1Values(z.string(), { database: 'datenbank', base_url: 'basis_url', account: 'konto', source: 'quelle' }),
      ok: z.boolean(),
      required: z.boolean(),
    }),
  ),
  ca: z.looseObject({
    existing: z.boolean(),
    fp_hex: z.string().optional(),
    cert_sha256: z.string().optional(),
    valid_until: z.string().optional(),
    download: z.string(),
  }),
  base_url: z.string().nullable(),
  https: z.boolean(),
  degraded: DEGRADED,
});
/** The settings as text, as they are stored; secrets masked. */
export const RawSettings = z.looseObject({
  success: z.literal(true),
  settings: z.record(v1Values(z.string(), V1_SETTING_KEYS), z.string()),
});
export const TlsState = z.looseObject({
  success: z.literal(true),
  https: z.boolean(),
  fp: z.string().nullable(),
  fp_hex: z.string().optional(),
  cert_sha256: z.string().optional(),
  subject: z.string().optional(),
  valid_until: time.optional(),
  download: z.string().optional(),
});
export const Backup = z.looseObject({
  version: z.string(),
  exported_at: time,
  exported_by: z.string().nullable(),
  global: z.record(v1Values(z.string(), V1_SETTING_KEYS), z.string()),
  user_settings: z.record(z.string(), z.string()),
});
/** The import file: what the export writes, older versions included. Values are checked by GLOBAL_RULES. */
export const ConfigExport = z.looseObject({
  version: z.string().max(20).optional(),
  exported_at: z.string().max(40).optional(),
  exported_by: z.string().max(200).nullable().optional(),
  global: z.record(z.string().max(64), SIMPLE).optional(),
  user_settings: z.record(z.string().max(64), SIMPLE).optional(),
});
export const BackupRestored = z.looseObject({
  success: z.literal(true),
  imported: whole,
  note: z.string(),
  smtp_skipped: z.array(z.string()),
});
/** Reachable without login (compose.yaml); everything except the status only for the admin. */
export const Health = z.looseObject({
  status: z.enum(['ok', 'starting']),
  startup: StartupStatus.optional(),
  db_pool: z.record(z.string(), z.unknown()).optional(),
  uptime_seconds: whole.optional(),
});
/** `ready` answers 503 in the shape of every error response, plus status "unavailable". */
export const Heartbeat = z.strictObject({ status: z.literal('ok') });

/** Result of the sending; without error text on success. */
export const SmtpProbe = z.looseObject({
  mode: z.string().nullable(),
  success: z.boolean(),
});

export const SettingsSaved = GenericResponse.extend({ updated: whole });

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(StartupStatus, { error: 'fehler' });
v1Keys(SetupState, { done: 'erledigt' });

export const routes = {
  'GET /api/v2/settings/theme': { response: AppThemeResponse },
  'GET /api/v2/settings': { response: SettingsResponse },
  'GET /api/v2/settings/default-condition': { response: DefaultConditionResponse },
  'GET /api/v2/startup-status': { response: StartupStatus },
  'POST /api/v2/settings/user/theme': {
    input: z.strictObject({ theme: TEXT(40).nullable().optional() }),
    response: AppThemeResponse,
  },
  'PUT /api/v2/settings': { input: SETTINGS, response: SettingsSaved },
  'POST /api/v2/settings/user/default-condition': {
    input: z.strictObject({ condition: CONDITION.nullable().optional() }),
    response: AdminCondition,
  },
  'POST /api/v2/settings/admin/theme': {
    input: z.strictObject({ theme: GLOBAL_RULES.app_theme }),
    response: AdminTheme,
  },
  // `klein`: six fixed check steps that do not grow with the inventory.
  'GET /api/v2/setup/state': { response: SetupState, small: true },
  'GET /api/v2/settings/setup': { response: Setup },
  'POST /api/v2/settings/setup/complete': { input: WITHOUT_BODY, response: Success },
  'GET /api/v2/settings/raw': { response: RawSettings },
  'GET /api/v2/settings/tls': { response: TlsState },
  'GET /api/v2/settings/user/default-condition': { response: DefaultConditionResponse },
  'POST /api/v2/settings': { response: Success, ...legacyConfirmation(settingFields, 'admin_password') },
  'GET /api/v2/settings/export': { response: Backup },
  'POST /api/v2/settings/import': { form: true, response: BackupRestored },
  'GET /api/v2/health': { response: Health },
  'GET /api/v2/health/live': { response: Heartbeat },
  'GET /api/v2/health/ready': { response: Heartbeat },
  'GET /api/v2/settings/export/data': { kind: 'zip' },
  'POST /api/v2/settings/smtp-test': { response: SmtpProbe, ...legacyConfirmation({ to: TEXT(320).optional() }) },
  'POST /api/v2/settings/test-source': {
    input: v1Keys(z.strictObject({ source: TEXT(40) }), { source: 'quelle' }),
    response: Success,
  },
} satisfies Record<string, Route>;
