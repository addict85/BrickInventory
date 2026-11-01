import { z } from 'zod';
import { VerwaltungZustand, VerwaltungDesign } from './verwaltung';
import { type Route, Erfolg, ganz, zeit } from './grund';
import { GenericResponse } from './gemeinsam';

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
/** Die Einstellungen als Text, wie sie gespeichert sind; Geheimnisse maskiert. */
export const RoheEinstellungen = z.looseObject({ success: z.literal(true), settings: z.record(z.string(), z.string()) });
export const TlsStand = z.looseObject({
  success: z.literal(true), https: z.boolean(), fp: z.string().nullable(), fp_hex: z.string().optional(),
  subject: z.string().optional(), gueltig_bis: zeit.optional(), download: z.string().optional(),
});
export const Sicherung = z.looseObject({
  version: z.string(), exported_at: zeit, exported_by: z.string().nullable(),
  global: z.record(z.string(), z.string()), user_settings: z.record(z.string(), z.string()),
});
export const SicherungEingespielt = z.looseObject({
  success: z.literal(true), imported: ganz, note: z.string(), smtp_uebergangen: z.array(z.string()).optional(),
});
/** Ohne Anmeldung erreichbar (compose.yaml); alles ausser dem Status nur für den Verwalter. */
export const Gesundheit = z.looseObject({
  status: z.enum(['ok', 'starting']), startup: StartupStatus.optional(),
  db_pool: z.record(z.string(), z.unknown()).optional(), uptime_seconds: ganz.optional(),
});
/** `ready` antwortet 503 mit status "unavailable", wenn die Datenbank nicht antwortet. */
export const Lebenszeichen = z.strictObject({ status: z.literal('ok') });

/** Ergebnis des Versands; bei Erfolg ohne Fehlertext. */
export const SmtpProbe = z.looseObject({ success: z.boolean() });

export const EinstellungenGespeichert = GenericResponse.extend({ updated: ganz });

export const routen = {
  'GET /api/v1/settings/theme': { antwort: AppThemeResponse },
  'GET /api/v1/settings': { antwort: SettingsResponse },
  'GET /api/v1/settings/default-condition': { antwort: DefaultConditionResponse },
  'GET /api/v1/startup-status': { antwort: StartupStatus },
  'POST /api/v1/settings/user/theme': { antwort: AppThemeResponse },
  'PUT /api/v1/settings': { antwort: EinstellungenGespeichert },
  'POST /api/v1/settings/user/default-condition': { antwort: VerwaltungZustand },
  'POST /api/v1/settings/admin/theme': { antwort: VerwaltungDesign },
  'GET /api/v1/settings/einrichtung': { antwort: Einrichtung },
  'POST /api/v1/settings/einrichtung/fertig': { antwort: Erfolg },
  'GET /api/v1/settings/raw': { antwort: RoheEinstellungen },
  'GET /api/v1/settings/tls': { antwort: TlsStand },
  'GET /api/v1/settings/user/default-condition': { antwort: DefaultConditionResponse },
  'POST /api/v1/settings': { antwort: Erfolg },
  'GET /api/v1/settings/export': { antwort: Sicherung },
  'POST /api/v1/settings/import': { antwort: SicherungEingespielt },
  'GET /api/v1/health': { antwort: Gesundheit },
  'GET /api/v1/health/live': { antwort: Lebenszeichen },
  'GET /api/v1/health/ready': { antwort: Lebenszeichen },
  'GET /api/v1/settings/export/data': { art: 'zip' },
  'POST /api/v1/settings/smtp-test': { antwort: SmtpProbe },
  'POST /api/v1/settings/quelle-testen': { antwort: Erfolg },
} satisfies Record<string, Route>;
