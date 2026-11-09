import crypto from 'node:crypto';
import { eingabe } from '../infra/validate';
import { fachfehler, type FehlerCode } from '../infra/fehlerTexte';

/** Dieselbe Liste wie ALLOWED in public/js/00-theme-boot.js (theme.test.js). */
export const DESIGNS: readonly string[] = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

/** Ein globaler Wert wird als Text gespeichert, auch wenn er als Zahl kommt. */
const wert = (gueltig: (v: string) => boolean, json: Record<string, unknown>, code: FehlerCode = 'wert_ungueltig') =>
  eingabe.regel((v): string => {
    if ((typeof v !== 'string' && typeof v !== 'number') || !gueltig(String(v))) fachfehler('ungueltig', code);
    return String(v);
  }, json);
const ganzzahl = (min: number, max: number, code?: FehlerCode) =>
  wert(
    v => /^\d{1,9}$/.test(v) && +v >= min && +v <= max,
    { type: ['integer', 'string'], minimum: min, maximum: max },
    code,
  );
const text = (max: number) =>
  wert(v => v.length <= max && !/[\u0000-\u001f\u007f]/.test(v), { type: 'string', maxLength: max });
const auswahl = (werte: readonly string[], code?: FehlerCode) =>
  wert(v => werte.includes(v), { enum: [...werte] }, code);
const JA_NEIN_WERT = auswahl(['0', '1']);
const UHRZEIT = wert(v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v), {
  type: 'string',
  pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
});

/** Die eine Regel je globalem Schlüssel: setGlobalSetting, der Vertrag und der
 * Import prüfen dagegen. Ein Schlüssel ohne Regel wird nicht geschrieben. */
export const GLOBALE_REGELN = {
  bricklink_consumer_key: text(200),
  bricklink_consumer_secret: text(200),
  bricklink_token: text(200),
  bricklink_token_secret: text(200),
  brickset_api_key: text(200),
  rebrickable_api_key: text(200),
  price_job_interval_minutes: ganzzahl(5, 10_080),
  price_cache_ttl: auswahl(['12', '24', '168']),
  api_limit_rebrickable: ganzzahl(1, 100_000, 'tageslimit_bereich'),
  api_limit_bricklink: ganzzahl(1, 100_000, 'tageslimit_bereich'),
  api_limit_brickset: ganzzahl(1, 100_000, 'tageslimit_bereich'),
  registration_enabled: JA_NEIN_WERT,
  smtp_secure: JA_NEIN_WERT,
  einrichtung_erledigt: JA_NEIN_WERT,
  smtp_host: text(253),
  smtp_port: wert(v => v === '' || (/^\d{1,5}$/.test(v) && +v >= 1 && +v <= 65_535), {
    type: ['integer', 'string'],
    minimum: 1,
    maximum: 65_535,
  }),
  smtp_user: text(320),
  smtp_pass: text(500),
  smtp_from: text(320),
  // Ein unlesbarer Fingerabdruck oder ein kaputtes PEM fiele sonst erst beim Versand auf.
  smtp_tls_fingerprint: wert(v => v === '' || /^[0-9A-F]{64}$/.test(v.replace(/[\s:]/g, '').toUpperCase()), {
    type: 'string',
  }),
  smtp_tls_ca: wert(
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
  default_price_condition: auswahl(['N', 'U'], 'zustand_n_oder_u'),
  gutschein_land: wert(v => v === '' || /^[A-Z]{2}$/.test(v), { type: 'string', pattern: '^([A-Z]{2})?$' }),
  app_theme: auswahl(DESIGNS, 'design_ungueltig'),
  job_time_brickset_retry: UHRZEIT,
  job_time_csv_sync: UHRZEIT,
} as const;
export type GlobalerSchluessel = keyof typeof GLOBALE_REGELN;
