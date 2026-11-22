import { z } from 'zod';
import { type Route, time, whole, WITHOUT_BODY, TEXT, JA_NO, query, Q, PAGE, PAGES_DETAIL } from './base';
import { GenericAdminResponse, ImportZeile } from './shared';

export { ImportZeile };
import { GLOBAL_RULES } from './globalRules';

export const ApiLimits = z.looseObject({
  rebrickable: z.number().int(),
  bricklink: z.number().int(),
  brickset: z.number().int(),
});

export const ApiLimitsResponse = z.looseObject({
  success: z.boolean(),
  limits: ApiLimits,
});

export const JobProgress = z.looseObject({
  erledigt: z.number().int().nullable().optional(),
  gesamt: z.number().int().nullable().optional(),
  text: z.string().nullable().optional(),
});

export const Job = z.looseObject({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  due_at: time.nullable(),
  deadline_at: time.nullable(),
  started_at: time.nullable(),
  created_at: time.nullable(),
  updated_at: time.nullable(),
  progress: JobProgress.nullable(),
  error_message: z.string().nullable(),
  geplant: z.boolean(),
  /** Postponed (quota, throttling): waits until due_at, `error_message` names the reason. */
  waiting: z.boolean(),
  set_number: z.string().nullable(),
});

export const JobCounter = z.looseObject({
  type: z.string(),
  status: z.string(),
  anzahl: z.number().int(),
});

export const JobPause = z.looseObject({
  type: z.string(),
  until_at: time.nullable(),
  reason: z.string().nullable(),
});

export const JobProcess = z.looseObject({
  lebenszeichen: z.string().nullable(),
  alter_sekunden: z.number().int().nullable(),
  laeuft: z.boolean(),
});

export const AuftraegeResponse = z.looseObject({
  success: z.boolean(),
  auftraege: z.array(Job),
  zusammenfassung: z.array(JobCounter),
  pausen: z.array(JobPause),
  bildbedarf: z.number().int(),
  job_prozess: JobProcess,
});

export const JobChange = z.looseObject({
  success: z.boolean(),
  id: z.string(),
  status: z.string(),
});

export const JobKindDrain = z.looseObject({
  success: z.boolean(),
  art: z.string(),
  entfernt: z.number().int(),
});

export const JobKindStart = z.looseObject({
  success: z.boolean(),
  art: z.string(),
  gestartet: z.boolean(),
});

export const BricksetQueueEntry = z.looseObject({
  created_at: time.nullable(),
  set_number: z.string(),
  name: z.string().nullable(),
  attempts: z.number().int(),
  retry_after: z.string().nullable(),
  last_error: z.string().nullable(),
});

export const BricksetQueueResponse = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  count: z.number().int(),
  entries: z.array(BricksetQueueEntry),
});

export const RateLimit = z.looseObject({
  date: z.string().nullable().optional(),
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
  db_pool: z.record(z.string(), z.unknown()),
  success: z.boolean(),
  prices: z.number().int(),
  subsets: z.number().int(),
  catalog: z.number().int(),
  price_stale: z.number().int(),
  rate_limits: RateLimits.nullable(),
  /** Parts of the response that carry only substitute values after an error. */
  degradiert: z.array(z.string()).optional(),
});

export const CacheTtlResponse = z.looseObject({
  success: z.boolean(),
  ttl: z.string(),
});

export const CsvImportStatus = z.looseObject({
  code: z.string().nullable().optional(),
  results: z.array(ImportZeile).optional(),
  success: z.boolean(),
  status: z.string().optional(),
  total: z.number().int().optional(),
  done: z.number().int().optional(),
  current: z.string().nullable().optional(),
  ok: z.number().int().optional(),
  warn: z.number().int().optional(),
  err: z.number().int().optional(),
  error: z.string().nullable(),
  beendet_am: time.optional(),
});

export const JobSchedule = z.looseObject({
  type: z.string(),
  time: time.nullable().optional(),
  minutes: z.number().int().nullable().optional(),
});

export const JobStatus = z.looseObject({
  lastRun: z.union([z.string(), z.number()]).nullable().optional(),
  canRedownload: z.boolean().optional(),
  queue: z.number().int().nullable().optional(),
  queueLastRun: z.union([z.string(), z.number()]).nullable().optional(),
  label: z.string(),
  status: z.string(),
  progress: z.number().int(),
  total: z.number().int(),
  sub: z.string().nullable().optional(),
  sub_teile: z
    .array(
      z.object({
        code: z.string(),
        werte: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        vor: z.literal('bestand').optional(),
      }),
    )
    .optional(),
});

export const JobsResponse = z.looseObject({
  db: z.record(z.string(), z.unknown()),
  success: z.boolean(),
  jobs: z.record(z.string(), JobStatus),
  schedules: z.record(z.string(), JobSchedule),
  degradiert: z.array(z.string()).optional(),
  proxy_hinweis: z
    .object({
      art: z.enum(['gateway', 'docker_netz', 'eine_adresse']),
      vars: z.object({ ip: z.string(), minuten: whole.optional(), anzahl: whole.optional() }),
    })
    .nullable()
    .optional(),
});

export const LogRow = z.looseObject({
  id: z.number().int().nullable().optional(),
  level: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  logged_at: time.nullable().optional(),
});

export const LogResponse = z.looseObject({
  success: z.boolean(),
  minutes: z.number().int(),
  count: z.number().int(),
  logs: z.array(LogRow),
});

export const PriceJobState = z.looseObject({
  success: z.boolean(),
  job: z.looseObject({
    running: z.boolean(),
    lastRun: time.nullable(),
    nextRun: time.nullable(),
    lastErrors: whole,
    log: z.array(z.unknown()),
    lastDuration: z.number().nullable().optional(),
    lastUpdated: z.number().nullable().optional(),
    progress: z.looseObject({ current: z.unknown(), total: z.unknown(), set: z.unknown() }).nullable().optional(),
  }),
  rate_limit: z.looseObject({ count: whole, limit: whole, remaining: whole, date: z.string().nullable().optional() }),
});
/** The admin shows the entries raw; their fields are the columns of app_logs. */
export const LogEntries = z.looseObject({
  success: z.literal(true),
  eintraege: z.array(z.record(z.string(), z.unknown())),
});
export const ImageDiagnosis = z.looseObject({
  success: z.literal(true),
  set_number: z.string(),
  hinweise: z.array(z.string()),
  datenbank: z.looseObject({
    anzahl_konten: whole,
    image_local: z.string().nullable(),
    image_url: z.string().nullable(),
    katalog_bild: z.string().nullable(),
  }),
  lokal: z.looseObject({
    original: z.looseObject({ vorhanden: z.boolean(), bytes: whole, geaendert: time.nullable().optional() }),
    vorschau: z.looseObject({ vorhanden: z.boolean(), bytes: whole, geaendert: time.nullable().optional() }),
  }),
  proxy: z.looseObject({ gecacht: z.boolean(), adresse: z.string().nullable().optional() }),
  merker: z.looseObject({ seit: time.nullable(), grund: z.string().nullable() }).nullable(),
});
export const ImageMarkerForgotten = z.looseObject({ success: z.literal(true), entfernt: whole, hinweis: z.string() });

/** Diagnostics for the admin: the UI shows their fields raw. */
export const Diagnose = z.record(z.string(), z.unknown());
export const Endpoints = z.looseObject({
  auth: z.record(z.string(), z.unknown()).optional(),
  api: z.string(),
  version: z.string(),
  endpoints: z.record(z.string(), z.unknown()),
});

/** The admin's bulk responses with what the individual route says about it. */
export const VerwaltungMeldung = GenericAdminResponse.extend({ message: z.string() });
/** Instructions re-queued; without missing ones, `message` says why none. */
export const AnleitungenEingereiht = GenericAdminResponse.extend({ enqueued: whole, message: z.string().optional() });
export const KatalogBilderEingereiht = GenericAdminResponse.extend({
  queued: whole,
  pending: whole,
  skipped: whole,
  verworfen: whole,
  dauer_minuten: whole,
});
export const VerwaltungGestartet = GenericAdminResponse.extend({ started: z.boolean() });
export const VerwaltungSet = GenericAdminResponse.extend({ set_number: z.string() });
export const VerwaltungTtl = GenericAdminResponse.extend({ ttl: z.union([z.string(), whole]) });
export const VerwaltungZustand = GenericAdminResponse.extend({ condition: z.string().nullable() });
export const VerwaltungDesign = GenericAdminResponse.extend({ theme: z.string() });

export const routen = {
  // The rows of a running import: as many as the one file has.
  'GET /api/v1/sets/import/csv/status': { klein: true, antwort: CsvImportStatus },
  'GET /api/v1/sets/import/csv/stream': {
    art: 'strom',
    ereignis: CsvImportStatus,
    abfrage: query({ sprache: Q.text(2) }),
  },
  'GET /api/v1/admin/logs': { klein: true, antwort: LogResponse, abfrage: query({ minutes: Q.zahl() }) },
  'GET /api/v1/admin/jobs': { antwort: JobsResponse, klein: true },
  'GET /api/v1/admin/brickset-queue': { antwort: BricksetQueueResponse, abfrage: query(PAGE) },
  'GET /api/v1/admin/cache-stats': { antwort: CacheStatsResponse, klein: true },
  'GET /api/v1/admin/cache-ttl': { antwort: CacheTtlResponse },
  'GET /api/v1/admin/api-limits': { antwort: ApiLimitsResponse },
  'GET /api/v1/admin/auftraege': {
    klein: true,
    antwort: AuftraegeResponse,
    abfrage: query({ status: Q.text(20), art: Q.text(40) }),
  },
  'POST /api/v1/sets/import/csv/cancel': { eingabe: WITHOUT_BODY, antwort: GenericAdminResponse },
  'POST /api/v1/admin/job-schedule': {
    eingabe: z.strictObject({
      name: TEXT(40),
      time: TEXT(5).nullable().optional(),
      minutes: GLOBAL_RULES.price_job_interval_minutes.nullable().optional(),
    }),
    antwort: GenericAdminResponse,
  },
  'POST /api/v1/admin/catalog-images': {
    eingabe: z.strictObject({ alle_erneut: JA_NO.optional() }),
    antwort: KatalogBilderEingereiht,
  },
  'POST /api/v1/admin/brickset-queue/:setNumber/retry': { eingabe: WITHOUT_BODY, antwort: VerwaltungSet },
  'DELETE /api/v1/admin/brickset-queue/:setNumber': { eingabe: WITHOUT_BODY, antwort: VerwaltungSet },
  'POST /api/v1/admin/cache-ttl': {
    eingabe: z.strictObject({ ttl: GLOBAL_RULES.price_cache_ttl }),
    antwort: VerwaltungTtl,
  },
  'POST /api/v1/admin/cache-clear': {
    eingabe: z.strictObject({ all: JA_NO.optional() }),
    antwort: VerwaltungMeldung,
  },
  'PUT /api/v1/admin/api-limits': {
    eingabe: z.strictObject({
      rebrickable: GLOBAL_RULES.api_limit_rebrickable.optional(),
      bricklink: GLOBAL_RULES.api_limit_bricklink.optional(),
      brickset: GLOBAL_RULES.api_limit_brickset.optional(),
    }),
    antwort: GenericAdminResponse,
  },
  'POST /api/v1/admin/redownload-missing-images': { eingabe: WITHOUT_BODY, antwort: VerwaltungGestartet },
  'POST /api/v1/admin/auftraege/:id/abbrechen': { eingabe: WITHOUT_BODY, antwort: JobChange },
  'POST /api/v1/admin/auftraege/:id/wiederholen': { eingabe: WITHOUT_BODY, antwort: JobChange },
  'POST /api/v1/admin/auftraege/art/:art/jetzt': { eingabe: WITHOUT_BODY, antwort: JobKindStart },
  'DELETE /api/v1/admin/auftraege/art/:art': { eingabe: WITHOUT_BODY, antwort: JobKindDrain },
  'POST /api/v1/admin/trigger-csv-sync': { eingabe: WITHOUT_BODY, antwort: VerwaltungMeldung },
  'POST /api/v1/admin/reimport-instructions': { eingabe: WITHOUT_BODY, antwort: AnleitungenEingereiht },
  'POST /api/v1/admin/trigger-price-job': { eingabe: WITHOUT_BODY, antwort: VerwaltungGestartet },
  'POST /api/v1/admin/default-condition': {
    eingabe: z.strictObject({ condition: GLOBAL_RULES.default_price_condition }),
    antwort: VerwaltungZustand,
  },
  'GET /api/v1/admin/job-status': { antwort: PriceJobState },
  'GET /api/v1/admin/protokoll': { klein: true, antwort: LogEntries },
  'GET /api/v1/admin/image-diag/:setNumber': { klein: true, antwort: ImageDiagnosis },
  'POST /api/v1/admin/forget-image-misses': {
    eingabe: z.strictObject({ set_numbers: z.array(TEXT(40)).max(10_000).optional(), thumbs: JA_NO.optional() }),
    antwort: ImageMarkerForgotten,
  },
  'POST /api/v1/admin/img-probe': { antwort: Diagnose, eingabe: z.strictObject({ url: TEXT(2048).optional() }) },
  'POST /api/v1/admin/price-probe': {
    antwort: Diagnose,
    eingabe: z.strictObject({ set: TEXT(64).optional(), live: z.boolean().optional() }),
  },
  'GET /api/v1/': { antwort: Endpoints },
} satisfies Record<string, Route>;
