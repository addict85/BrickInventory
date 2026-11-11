import { z } from 'zod';
import { VerwaltungZustand, VerwaltungDesign } from './verwaltung';
import { type Route, Erfolg, ganz, zeit, bestaetigt, OHNE_RUMPF, TEXT, ZUSTAND, EINSTELLUNGEN, EINFACH } from './grund';
import { GLOBALE_REGELN } from './globaleRegeln';


/** Was POST /settings annimmt: global nur vom Verwalter, je Konto von jedem. */
export const GLOBALE_EINSTELLUNGEN = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token',
  'bricklink_token_secret', 'brickset_api_key', 'rebrickable_api_key', 'price_job_interval_minutes',
  'price_cache_ttl', 'api_limit_rebrickable', 'api_limit_bricklink', 'api_limit_brickset',
  'registration_enabled', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'smtp_tls_fingerprint', 'smtp_tls_ca', 'default_price_condition', 'gutschein_land'] as const;
export const KONTO_EINSTELLUNGEN = ['currency', 'language', 'user_default_condition'] as const;
type Einstellung = (typeof GLOBALE_EINSTELLUNGEN)[number] | (typeof KONTO_EINSTELLUNGEN)[number];
const einstellungsFelder = Object.fromEntries([...GLOBALE_EINSTELLUNGEN, ...KONTO_EINSTELLUNGEN]
  .map(k => [k, EINFACH.optional()])) as Record<Einstellung, z.ZodOptional<typeof EINFACH>>;
import { DEGRADIERT, GenericResponse } from './gemeinsam';

export const AppThemeResponse = z.looseObject({
  success: z.boolean(),
  theme: z.string(),
  vorgabe: z.string().nullable().optional(),
  eigenes: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
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
  user_default_condition: z.string().nullable().optional(),
  effective_condition: z.string(),
  app_theme: z.string(),
});

export const SettingsResponse = z.looseObject({
  success: z.boolean(),
  settings: UserSettings,
  error: z.string().nullable().optional(),
});

export const StartupStatus = z.looseObject({
  fehler: z.string().nullable().optional(),
  pfad: z.string().nullable().optional(),
  ready: z.boolean(),
  step: z.string().nullable().optional(),
  // Erledigte Schritte mit Anteil des laufenden (2.37 = Schritt 3 zu 37 %).
  progress: z.number().nonnegative(),
  total: z.number().int(),
  sub: z.string().nullable().optional(),
});

export const Einrichtung = z.looseObject({
  success: z.literal(true), offen: z.boolean(), passwort_aendern: z.boolean(),
  quellen: z.looseObject({ rebrickable: z.boolean(), bricklink: z.boolean(), brickset: z.boolean() }),
});
/** Stand der Ersteinrichtung für die Anmeldeseite: Schalter und das öffentliche
 * Wurzelzertifikat, keine Konten und keine Schlüssel. */
export const EinrichtungStand = z.looseObject({
  success: z.literal(true), erledigt: z.boolean(), konfiguriert: z.boolean(),
  schritte: z.array(z.looseObject({ id: z.string(), ok: z.boolean(), pflicht: z.boolean() })),
  ca: z.looseObject({ vorhanden: z.boolean(), fp_hex: z.string().optional(), zert_sha256: z.string().optional(),
                      gueltig_bis: z.string().optional(), download: z.string() }),
  basis_url: z.string().nullable(), https: z.boolean(), degradiert: DEGRADIERT,
});
/** Die Einstellungen als Text, wie sie gespeichert sind; Geheimnisse maskiert. */
export const RoheEinstellungen = z.looseObject({ success: z.literal(true), settings: z.record(z.string(), z.string()) });
export const TlsStand = z.looseObject({
  success: z.literal(true), https: z.boolean(), fp: z.string().nullable(), fp_hex: z.string().optional(),
  zert_sha256: z.string().optional(),
  subject: z.string().optional(), gueltig_bis: zeit.optional(), download: z.string().optional(),
});
export const Sicherung = z.looseObject({
  version: z.string(), exported_at: zeit, exported_by: z.string().nullable(),
  global: z.record(z.string(), z.string()), user_settings: z.record(z.string(), z.string()),
});
/** Die Importdatei: was der Export schreibt, ältere Fassungen eingeschlossen. Werte prüft GLOBALE_REGELN. */
export const KonfigExport = z.looseObject({
  version: z.string().max(20).optional(), exported_at: z.string().max(40).optional(),
  exported_by: z.string().max(200).nullable().optional(),
  global: z.record(z.string().max(64), EINFACH).optional(),
  user_settings: z.record(z.string().max(64), EINFACH).optional(),
});
export const SicherungEingespielt = z.looseObject({
  success: z.literal(true), imported: ganz, note: z.string(), smtp_uebergangen: z.array(z.string()).optional(),
});
/** Ohne Anmeldung erreichbar (compose.yaml); alles ausser dem Status nur für den Verwalter. */
export const Gesundheit = z.looseObject({
  status: z.enum(['ok', 'starting']), startup: StartupStatus.optional(),
  db_pool: z.record(z.string(), z.unknown()).optional(), uptime_seconds: ganz.optional(),
});
/** `ready` antwortet 503 in der Form jeder Fehlerantwort, dazu status "unavailable". */
export const Lebenszeichen = z.strictObject({ status: z.literal('ok') });

/** Ergebnis des Versands; bei Erfolg ohne Fehlertext. */
export const SmtpProbe = z.looseObject({ 
  mode: z.string().nullable().optional(),
  success: z.boolean() });

export const EinstellungenGespeichert = GenericResponse.extend({ updated: ganz });

export const routen = {
  'GET /api/v1/settings/theme': { antwort: AppThemeResponse },
  'GET /api/v1/settings': { antwort: SettingsResponse },
  'GET /api/v1/settings/default-condition': { antwort: DefaultConditionResponse },
  'GET /api/v1/startup-status': { antwort: StartupStatus },
  'POST /api/v1/settings/user/theme': { eingabe: z.strictObject({ theme: TEXT(40).nullable().optional() }), antwort: AppThemeResponse },
  'PUT /api/v1/settings': { eingabe: EINSTELLUNGEN, antwort: EinstellungenGespeichert },
  'POST /api/v1/settings/user/default-condition': { eingabe: z.strictObject({ condition: ZUSTAND.nullable().optional() }), antwort: VerwaltungZustand },
  'POST /api/v1/settings/admin/theme': { eingabe: z.strictObject({ theme: GLOBALE_REGELN.app_theme }), antwort: VerwaltungDesign },
  // `klein`: sechs feste Prüfschritte, die nicht mit dem Bestand wachsen.
  'GET /api/v1/einrichtung/stand': { antwort: EinrichtungStand, klein: true },
  'GET /api/v1/settings/einrichtung': { antwort: Einrichtung },
  'POST /api/v1/settings/einrichtung/fertig': { eingabe: OHNE_RUMPF, antwort: Erfolg },
  'GET /api/v1/settings/raw': { antwort: RoheEinstellungen },
  'GET /api/v1/settings/tls': { antwort: TlsStand },
  'GET /api/v1/settings/user/default-condition': { antwort: DefaultConditionResponse },
  'POST /api/v1/settings': { antwort: Erfolg, ...bestaetigt(einstellungsFelder, 'admin_password') },
  'GET /api/v1/settings/export': { antwort: Sicherung },
  'POST /api/v1/settings/import': { formular: true, antwort: SicherungEingespielt },
  'GET /api/v1/health': { antwort: Gesundheit },
  'GET /api/v1/health/live': { antwort: Lebenszeichen },
  'GET /api/v1/health/ready': { antwort: Lebenszeichen },
  'GET /api/v1/settings/export/data': { art: 'zip' },
  'POST /api/v1/settings/smtp-test': { antwort: SmtpProbe, ...bestaetigt({ to: TEXT(320).optional() }) },
  'POST /api/v1/settings/quelle-testen': { eingabe: z.strictObject({ quelle: TEXT(40) }), antwort: Erfolg },
} satisfies Record<string, Route>;
