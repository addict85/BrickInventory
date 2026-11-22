import { z } from 'zod';
import { VerwaltungZustand, VerwaltungDesign } from './management';
import { type Route, Success, whole, time, confirmed, WITHOUT_BODY, TEXT, CONDITION, SETTINGS, SIMPLE } from './base';
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
  'gutschein_land',
] as const;
export const ACCOUNT_SETTINGS = ['currency', 'language', 'user_default_condition'] as const;
type Setting = (typeof GLOBAL_SETTINGS)[number] | (typeof ACCOUNT_SETTINGS)[number];
const settingFields = Object.fromEntries(
  [...GLOBAL_SETTINGS, ...ACCOUNT_SETTINGS].map(k => [k, SIMPLE.optional()]),
) as Record<Setting, z.ZodOptional<typeof SIMPLE>>;
import { DEGRADED, GenericResponse } from './shared';

export const AppThemeResponse = z.looseObject({
  success: z.boolean(),
  theme: z.string(),
  vorgabe: z.string().nullable(),
  eigenes: z.string().nullable(),
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
});

export const SettingsResponse = z.looseObject({
  success: z.boolean(),
  settings: UserSettings,
});

export const StartupStatus = z.looseObject({
  fehler: z.string().nullable().optional(),
  pfad: z.string().nullable().optional(),
  ready: z.boolean(),
  step: z.string().nullable(),
  // Completed steps plus the share of the running one (2.37 = step 3 at 37 %).
  progress: z.number().nonnegative(),
  total: z.number().int(),
  sub: z.string().nullable(),
});

export const Setup = z.looseObject({
  success: z.literal(true),
  offen: z.boolean(),
  passwort_aendern: z.boolean(),
  quellen: z.looseObject({ rebrickable: z.boolean(), bricklink: z.boolean(), brickset: z.boolean() }),
});
/** State of the initial setup for the login page: switches and the public
 * root certificate, no accounts and no keys. */
export const SetupState = z.looseObject({
  success: z.literal(true),
  erledigt: z.boolean(),
  konfiguriert: z.boolean(),
  schritte: z.array(z.looseObject({ id: z.string(), ok: z.boolean(), pflicht: z.boolean() })),
  ca: z.looseObject({
    vorhanden: z.boolean(),
    fp_hex: z.string().optional(),
    zert_sha256: z.string().optional(),
    gueltig_bis: z.string().optional(),
    download: z.string(),
  }),
  basis_url: z.string().nullable(),
  https: z.boolean(),
  degradiert: DEGRADED,
});
/** The settings as text, as they are stored; secrets masked. */
export const RawSettings = z.looseObject({
  success: z.literal(true),
  settings: z.record(z.string(), z.string()),
});
export const TlsStand = z.looseObject({
  success: z.literal(true),
  https: z.boolean(),
  fp: z.string().nullable(),
  fp_hex: z.string().optional(),
  zert_sha256: z.string().optional(),
  subject: z.string().optional(),
  gueltig_bis: time.optional(),
  download: z.string().optional(),
});
export const Backup = z.looseObject({
  version: z.string(),
  exported_at: time,
  exported_by: z.string().nullable(),
  global: z.record(z.string(), z.string()),
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
  smtp_uebergangen: z.array(z.string()),
});
/** Reachable without login (compose.yaml); everything except the status only for the admin. */
export const Gesundheit = z.looseObject({
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

export const EinstellungenGespeichert = GenericResponse.extend({ updated: whole });

export const routen = {
  'GET /api/v1/settings/theme': { antwort: AppThemeResponse },
  'GET /api/v1/settings': { antwort: SettingsResponse },
  'GET /api/v1/settings/default-condition': { antwort: DefaultConditionResponse },
  'GET /api/v1/startup-status': { antwort: StartupStatus },
  'POST /api/v1/settings/user/theme': {
    eingabe: z.strictObject({ theme: TEXT(40).nullable().optional() }),
    antwort: AppThemeResponse,
  },
  'PUT /api/v1/settings': { eingabe: SETTINGS, antwort: EinstellungenGespeichert },
  'POST /api/v1/settings/user/default-condition': {
    eingabe: z.strictObject({ condition: CONDITION.nullable().optional() }),
    antwort: VerwaltungZustand,
  },
  'POST /api/v1/settings/admin/theme': {
    eingabe: z.strictObject({ theme: GLOBAL_RULES.app_theme }),
    antwort: VerwaltungDesign,
  },
  // `klein`: six fixed check steps that do not grow with the inventory.
  'GET /api/v1/einrichtung/stand': { antwort: SetupState, klein: true },
  'GET /api/v1/settings/einrichtung': { antwort: Setup },
  'POST /api/v1/settings/einrichtung/fertig': { eingabe: WITHOUT_BODY, antwort: Success },
  'GET /api/v1/settings/raw': { antwort: RawSettings },
  'GET /api/v1/settings/tls': { antwort: TlsStand },
  'GET /api/v1/settings/user/default-condition': { antwort: DefaultConditionResponse },
  'POST /api/v1/settings': { antwort: Success, ...confirmed(settingFields, 'admin_password') },
  'GET /api/v1/settings/export': { antwort: Backup },
  'POST /api/v1/settings/import': { formular: true, antwort: BackupRestored },
  'GET /api/v1/health': { antwort: Gesundheit },
  'GET /api/v1/health/live': { antwort: Heartbeat },
  'GET /api/v1/health/ready': { antwort: Heartbeat },
  'GET /api/v1/settings/export/data': { art: 'zip' },
  'POST /api/v1/settings/smtp-test': { antwort: SmtpProbe, ...confirmed({ to: TEXT(320).optional() }) },
  'POST /api/v1/settings/quelle-testen': { eingabe: z.strictObject({ quelle: TEXT(40) }), antwort: Success },
} satisfies Record<string, Route>;
