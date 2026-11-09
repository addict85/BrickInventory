import { z } from 'zod';
import { type Route, zeit, ganz, OHNE_RUMPF, TEXT, JA_NEIN, abfrage, Q, SEITE, SEITEN_ANGABE } from './grund';
import { GenericAdminResponse } from './gemeinsam';
import { GLOBALE_REGELN } from './globaleRegeln';

export const ApiLimits = z.looseObject({
  rebrickable: z.number().int(),
  bricklink: z.number().int(),
  brickset: z.number().int(),
});

export const ApiLimitsResponse = z.looseObject({
  success: z.boolean(),
  limits: ApiLimits,
});

export const AuftragFortschritt = z.looseObject({
  erledigt: z.number().int().nullable().optional(),
  gesamt: z.number().int().nullable().optional(),
  text: z.string().nullable().optional(),
});

export const Auftrag = z.looseObject({
  id: z.string(),
  art: z.string(),
  status: z.string(),
  versuche: z.number().int(),
  max_versuche: z.number().int(),
  faellig_ab: zeit.nullable(),
  frist_bis: zeit.nullable(),
  gestartet: zeit.nullable(),
  erstellt: zeit.nullable(),
  aktualisiert: zeit.nullable(),
  fortschritt: AuftragFortschritt.nullable(),
  fehler: z.string().nullable(),
  geplant: z.boolean(),
  set_number: z.string().nullable(),
});

export const AuftragZaehler = z.looseObject({
  art: z.string(),
  status: z.string(),
  anzahl: z.number().int(),
});

export const AuftragPause = z.looseObject({
  art: z.string(),
  bis: zeit.nullable(),
  grund: z.string().nullable(),
});

export const JobProzess = z.looseObject({
  lebenszeichen: z.string().nullable(),
  alter_sekunden: z.number().int().nullable(),
  laeuft: z.boolean(),
});

export const AuftraegeResponse = z.looseObject({
  success: z.boolean(),
  auftraege: z.array(Auftrag),
  zusammenfassung: z.array(AuftragZaehler),
  pausen: z.array(AuftragPause),
  bildbedarf: z.number().int(),
  job_prozess: JobProzess,
});

export const AuftragAenderung = z.looseObject({
  success: z.boolean(),
  id: z.string(),
  status: z.string(),
});

export const AuftragsArtLeerung = z.looseObject({
  success: z.boolean(),
  art: z.string(),
  entfernt: z.number().int(),
});

export const AuftragsArtStart = z.looseObject({
  success: z.boolean(),
  art: z.string(),
  gestartet: z.boolean(),
});

export const BricksetQueueEntry = z.looseObject({
  set_number: z.string(),
  name: z.string().nullable().optional(),
  attempts: z.number().int(),
  retry_after: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
});

export const BricksetQueueResponse = z.looseObject({
  success: z.boolean(),
  ...SEITEN_ANGABE,
  count: z.number().int(),
  entries: z.array(BricksetQueueEntry),
});

export const RateLimit = z.looseObject({
  count: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(),
});

export const RateLimits = z.looseObject({
  bricklink: RateLimit,
  rebrickable: RateLimit,
  brickset: RateLimit,
});

export const CacheStatsResponse = z.looseObject({
  success: z.boolean(),
  prices: z.number().int(),
  subsets: z.number().int(),
  catalog: z.number().int(),
  price_stale: z.number().int(),
  rate_limits: RateLimits.nullable().optional(),
});

export const CacheTtlResponse = z.looseObject({
  success: z.boolean(),
  ttl: z.string(),
});

export const CsvImportStatus = z.looseObject({
  success: z.boolean(),
  status: z.string().nullable().optional(),
  total: z.number().int().nullable().optional(),
  done: z.number().int().nullable().optional(),
  current: z.string().nullable().optional(),
  ok: z.number().int().nullable().optional(),
  warn: z.number().int().nullable().optional(),
  err: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
  beendet_am: zeit.optional(),
});

export const JobSchedule = z.looseObject({
  type: z.string(),
  time: zeit.nullable().optional(),
  minutes: z.number().int().nullable().optional(),
});

export const JobStatus = z.looseObject({
  label: z.string(),
  status: z.string(),
  progress: z.number().int(),
  total: z.number().int(),
  sub: z.string().nullable().optional(),
  sub_teile: z.array(z.object({ code: z.string(), werte: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    vor: z.literal('bestand').optional() })).optional(),
});

export const JobsResponse = z.looseObject({
  success: z.boolean(),
  jobs: z.record(z.string(), JobStatus),
  schedules: z.record(z.string(), JobSchedule),
});

export const ProtokollZeile = z.looseObject({
  id: z.number().int().nullable().optional(),
  level: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  logged_at: zeit.nullable().optional(),
});

export const ProtokollResponse = z.looseObject({
  success: z.boolean(),
  minutes: z.number().int(),
  count: z.number().int(),
  logs: z.array(ProtokollZeile),
  error: z.string().nullable().optional(),
});

export const PreisJobStand = z.looseObject({
  success: z.boolean(),
  job: z.looseObject({ running: z.boolean(), lastRun: zeit.nullable(), nextRun: zeit.nullable(), lastErrors: ganz,
    log: z.array(z.unknown()) }),
  rate_limit: z.looseObject({ count: ganz, limit: ganz, remaining: ganz }),
});
/** Die Einträge zeigt die Verwaltung roh an; ihre Felder sind die Spalten von app_logs. */
export const ProtokollEintraege = z.looseObject({ success: z.literal(true), eintraege: z.array(z.record(z.string(), z.unknown())) });
export const BildDiagnose = z.looseObject({
  success: z.literal(true), set_number: z.string(), hinweise: z.array(z.string()),
  datenbank: z.looseObject({ anzahl_konten: ganz, image_local: z.string().nullable(), image_url: z.string().nullable(),
    katalog_bild: z.string().nullable() }),
  lokal: z.looseObject({ original: z.looseObject({ vorhanden: z.boolean(), bytes: ganz }),
    vorschau: z.looseObject({ vorhanden: z.boolean(), bytes: ganz }) }),
  proxy: z.looseObject({ gecacht: z.boolean() }),
  merker: z.looseObject({ seit: zeit.nullable(), grund: z.string().nullable() }).nullable(),
});
export const BildMerkerVergessen = z.looseObject({ success: z.literal(true), entfernt: ganz, hinweis: z.string() });

/** Diagnosen für die Verwaltung: Ihre Felder zeigt die Oberfläche roh an. */
export const Diagnose = z.record(z.string(), z.unknown());
export const Endpunkte = z.looseObject({ api: z.string(), version: z.string(), endpoints: z.record(z.string(), z.unknown()) });

/** Sammelantworten der Verwaltung mit dem, was die einzelne Route dazu sagt. */
export const VerwaltungMeldung = GenericAdminResponse.extend({ message: z.string().optional() });
export const VerwaltungGestartet = GenericAdminResponse.extend({ started: z.boolean() });
export const VerwaltungSet = GenericAdminResponse.extend({ set_number: z.string() });
export const VerwaltungTtl = GenericAdminResponse.extend({ ttl: z.union([z.string(), ganz]) });
export const VerwaltungZustand = GenericAdminResponse.extend({ condition: z.string().nullable() });
export const VerwaltungDesign = GenericAdminResponse.extend({ theme: z.string() });

export const routen = {
  'GET /api/v1/sets/import/csv/status': { antwort: CsvImportStatus },
  'GET /api/v1/admin/logs': { klein: true, antwort: ProtokollResponse, abfrage: abfrage({ minutes: Q.zahl() }) },
  'GET /api/v1/admin/jobs': { antwort: JobsResponse },
  'GET /api/v1/admin/brickset-queue': { antwort: BricksetQueueResponse, abfrage: abfrage(SEITE) },
  'GET /api/v1/admin/cache-stats': { antwort: CacheStatsResponse },
  'GET /api/v1/admin/cache-ttl': { antwort: CacheTtlResponse },
  'GET /api/v1/admin/api-limits': { antwort: ApiLimitsResponse },
  'GET /api/v1/admin/auftraege': { klein: true, antwort: AuftraegeResponse, abfrage: abfrage({ status: Q.text(20), art: Q.text(40) }) },
  'POST /api/v1/sets/import/csv/cancel': { eingabe: OHNE_RUMPF, antwort: GenericAdminResponse },
  'POST /api/v1/admin/job-schedule': { eingabe: z.strictObject({ name: TEXT(40), time: TEXT(5).nullable().optional(), minutes: GLOBALE_REGELN.price_job_interval_minutes.nullable().optional() }), antwort: GenericAdminResponse },
  'POST /api/v1/admin/catalog-images': { eingabe: z.strictObject({ alle_erneut: JA_NEIN.optional() }), antwort: GenericAdminResponse },
  'POST /api/v1/admin/brickset-queue/:setNumber/retry': { eingabe: OHNE_RUMPF, antwort: VerwaltungSet },
  'DELETE /api/v1/admin/brickset-queue/:setNumber': { eingabe: OHNE_RUMPF, antwort: VerwaltungSet },
  'POST /api/v1/admin/cache-ttl': { eingabe: z.strictObject({ ttl: GLOBALE_REGELN.price_cache_ttl }), antwort: VerwaltungTtl },
  'POST /api/v1/admin/cache-clear': { eingabe: z.strictObject({ all: JA_NEIN.optional() }), antwort: VerwaltungMeldung },
  'PUT /api/v1/admin/api-limits': { eingabe: z.strictObject({ rebrickable: GLOBALE_REGELN.api_limit_rebrickable.optional(),
    bricklink: GLOBALE_REGELN.api_limit_bricklink.optional(), brickset: GLOBALE_REGELN.api_limit_brickset.optional() }), antwort: GenericAdminResponse },
  'POST /api/v1/admin/redownload-missing-images': { eingabe: OHNE_RUMPF, antwort: VerwaltungGestartet },
  'POST /api/v1/admin/auftraege/:id/abbrechen': { eingabe: OHNE_RUMPF, antwort: AuftragAenderung },
  'POST /api/v1/admin/auftraege/:id/wiederholen': { eingabe: OHNE_RUMPF, antwort: AuftragAenderung },
  'POST /api/v1/admin/auftraege/art/:art/jetzt': { eingabe: OHNE_RUMPF, antwort: AuftragsArtStart },
  'DELETE /api/v1/admin/auftraege/art/:art': { eingabe: OHNE_RUMPF, antwort: AuftragsArtLeerung },
  'POST /api/v1/admin/trigger-csv-sync': { eingabe: OHNE_RUMPF, antwort: VerwaltungMeldung },
  'POST /api/v1/admin/reimport-instructions': { eingabe: OHNE_RUMPF, antwort: VerwaltungMeldung },
  'POST /api/v1/admin/trigger-price-job': { eingabe: OHNE_RUMPF, antwort: VerwaltungGestartet },
  'POST /api/v1/admin/default-condition': { eingabe: z.strictObject({ condition: GLOBALE_REGELN.default_price_condition }), antwort: VerwaltungZustand },
  'GET /api/v1/admin/job-status': { antwort: PreisJobStand },
  'GET /api/v1/admin/protokoll': { klein: true, antwort: ProtokollEintraege },
  'GET /api/v1/admin/image-diag/:setNumber': { klein: true, antwort: BildDiagnose },
  'POST /api/v1/admin/forget-image-misses': { eingabe: z.strictObject({ set_numbers: z.array(TEXT(40)).max(10_000).optional(), thumbs: JA_NEIN.optional() }), antwort: BildMerkerVergessen },
  'POST /api/v1/admin/img-probe': { antwort: Diagnose, eingabe: z.strictObject({ url: TEXT(2048).optional() }) },
  'POST /api/v1/admin/price-probe': { antwort: Diagnose, eingabe: z.strictObject({ set: TEXT(64).optional(), live: z.boolean().optional() }) },
  'GET /api/v1/': { antwort: Endpunkte },
} satisfies Record<string, Route>;
