import crypto from 'node:crypto';
import { input } from '../infra/validate';
import { failDomain, type ErrorCode } from '../infra/errorTexts';

/** The same list as ALLOWED in public/js/theme-boot.js (theme.test.js). */
export const DESIGNS: readonly string[] = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

/** A global value is stored as text, even if it comes as a number. */
const value = (valid: (v: string) => boolean, json: Record<string, unknown>, code: ErrorCode = 'value_invalid') =>
  input.rule((v): string => {
    if ((typeof v !== 'string' && typeof v !== 'number') || !valid(String(v))) failDomain('invalid', code);
    return String(v);
  }, json);
const integer = (min: number, max: number, code?: ErrorCode) =>
  value(
    v => /^\d{1,9}$/.test(v) && +v >= min && +v <= max,
    { type: ['integer', 'string'], minimum: min, maximum: max },
    code,
  );
const text = (max: number) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: filtering out control characters is the purpose of this spot.
  value(v => v.length <= max && !/[\u0000-\u001f\u007f]/.test(v), { type: 'string', maxLength: max });
const selection = (values: readonly string[], code?: ErrorCode) =>
  value(v => values.includes(v), { enum: [...values] }, code);
const YES_NO_VALUE = selection(['0', '1']);
const TIME_OF_DAY = value(v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v), {
  type: 'string',
  pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
});

/** The one rule per global key: setGlobalSetting, the contract and the
 * import check against it. A key without a rule is not written. */
export const GLOBAL_RULES = {
  bricklink_consumer_key: text(200),
  bricklink_consumer_secret: text(200),
  bricklink_token: text(200),
  bricklink_token_secret: text(200),
  brickset_api_key: text(200),
  rebrickable_api_key: text(200),
  price_job_interval_minutes: integer(5, 10_080),
  price_cache_ttl: selection(['12', '24', '168']),
  api_limit_rebrickable: integer(1, 100_000, 'daily_limit_area'),
  api_limit_bricklink: integer(1, 100_000, 'daily_limit_area'),
  api_limit_brickset: integer(1, 100_000, 'daily_limit_area'),
  registration_enabled: YES_NO_VALUE,
  smtp_secure: YES_NO_VALUE,
  einrichtung_erledigt: YES_NO_VALUE,
  smtp_host: text(253),
  smtp_port: value(v => v === '' || (/^\d{1,5}$/.test(v) && +v >= 1 && +v <= 65_535), {
    type: ['integer', 'string'],
    minimum: 1,
    maximum: 65_535,
  }),
  smtp_user: text(320),
  smtp_pass: text(500),
  smtp_from: text(320),
  // An unreadable fingerprint or a broken PEM would otherwise only be noticed when sending.
  smtp_tls_fingerprint: value(v => v === '' || /^[0-9A-F]{64}$/.test(v.replace(/[\s:]/g, '').toUpperCase()), {
    type: 'string',
  }),
  smtp_tls_ca: value(
    v => {
      if (v.trim() === '') return true;
      try {
        return v.length <= 20_000 && !!new crypto.X509Certificate(v);
      } catch {
        return false;
      }
    },
    { type: 'string', maxLength: 20_000 },
  ),
  default_price_condition: selection(['N', 'U'], 'condition_n_or_u'),
  voucher_country: value(v => v === '' || /^[A-Z]{2}$/.test(v), { type: 'string', pattern: '^([A-Z]{2})?$' }),
  app_theme: selection(DESIGNS, 'theme_invalid'),
  job_time_brickset_retry: TIME_OF_DAY,
  job_time_csv_sync: TIME_OF_DAY,
} as const;
export type GlobalKey = keyof typeof GLOBAL_RULES;
