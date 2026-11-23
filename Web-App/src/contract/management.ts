import { z } from 'zod';
import { v1Keys, v1Values } from './v1';
import { V1_JOB_KINDS, V1_JOB_STATUS, V1_MONITOR_CODES, V1_PROXY_HINTS, V1_ADMIN_ACTIONS } from './v1Names';
import { type Route, time, whole, WITHOUT_BODY, TEXT, YES_NO, query, Q, PAGE, PAGES_DETAIL } from './base';
import { GenericAdminResponse, ImportRow } from './shared';

export { ImportRow };
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
  done: z.number().int().nullable().optional(),
  total: z.number().int().nullable().optional(),
  text: z.string().nullable().optional(),
});

/** Stored job kinds and status are English since migration 0136; v1 shows the former values. */
const jobKind = () => v1Values(z.string(), V1_JOB_KINDS);
const jobStatus = () => v1Values(z.string(), V1_JOB_STATUS);

export const Job = z.looseObject({
  id: z.string(),
  type: jobKind(),
  status: jobStatus(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  due_at: time.nullable(),
  deadline_at: time.nullable(),
  started_at: time.nullable(),
  created_at: time.nullable(),
  updated_at: time.nullable(),
  progress: JobProgress.nullable(),
  error_message: z.string().nullable(),
  scheduled: z.boolean(),
  /** Postponed (quota, throttling): waits until due_at, `error_message` names the reason. */
  waiting: z.boolean(),
  set_number: z.string().nullable(),
});

export const JobCounter = z.looseObject({
  type: jobKind(),
  status: jobStatus(),
  count: z.number().int(),
});

export const JobPause = z.looseObject({
  type: jobKind(),
  until_at: time.nullable(),
  reason: z.string().nullable(),
});

export const JobProcess = z.looseObject({
  heartbeat: z.string().nullable(),
  age_seconds: z.number().int().nullable(),
  running: z.boolean(),
});

export const JobQueueResponse = z.looseObject({
  success: z.boolean(),
  jobs: z.array(Job),
  summary: z.array(JobCounter),
  pauses: z.array(JobPause),
  image_demand: z.number().int(),
  job_process: JobProcess,
});

export const JobChange = z.looseObject({
  success: z.boolean(),
  id: z.string(),
  status: jobStatus(),
});

export const JobKindDrain = z.looseObject({
  success: z.boolean(),
  kind: jobKind(),
  removed: z.number().int(),
});

export const JobKindStart = z.looseObject({
  success: z.boolean(),
  kind: jobKind(),
  started: z.boolean(),
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
  degraded: z.array(z.string()).optional(),
});

export const CacheTtlResponse = z.looseObject({
  success: z.boolean(),
  ttl: z.string(),
});

export const CsvImportStatus = z.looseObject({
  code: z.string().nullable().optional(),
  results: z.array(ImportRow).optional(),
  success: z.boolean(),
  status: z.string().optional(),
  total: z.number().int().optional(),
  done: z.number().int().optional(),
  current: z.string().nullable().optional(),
  ok: z.number().int().optional(),
  warn: z.number().int().optional(),
  err: z.number().int().optional(),
  error: z.string().nullable(),
  finished_at: time.optional(),
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
  sub_parts: z
    .array(
      z.object({
        code: v1Values(z.string(), V1_MONITOR_CODES),
        values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        ago: v1Values(z.literal('holding'), V1_MONITOR_CODES).optional(),
      }),
    )
    .optional(),
});

export const JobsResponse = z.looseObject({
  db: z.record(z.string(), z.unknown()),
  success: z.boolean(),
  jobs: z.record(z.string(), JobStatus),
  schedules: z.record(z.string(), JobSchedule),
  degraded: z.array(z.string()).optional(),
  proxy_hint: z
    .object({
      kind: v1Values(z.enum(['gateway', 'docker_network', 'single_address']), V1_PROXY_HINTS),
      vars: z.object({ ip: z.string(), minutes: whole.optional(), count: whole.optional() }),
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
  entries: z.array(z.record(z.string(), v1Values(z.unknown(), V1_ADMIN_ACTIONS))),
});
export const ImageDiagnosis = z.looseObject({
  success: z.literal(true),
  set_number: z.string(),
  hints: z.array(z.string()),
  database: z.looseObject({
    account_count: whole,
    image_local: z.string().nullable(),
    image_url: z.string().nullable(),
    catalog_image: z.string().nullable(),
  }),
  local: z.looseObject({
    original: z.looseObject({ existing: z.boolean(), bytes: whole, changed: time.nullable().optional() }),
    preview: z.looseObject({ existing: z.boolean(), bytes: whole, changed: time.nullable().optional() }),
  }),
  proxy: z.looseObject({ cached: z.boolean(), address: z.string().nullable().optional() }),
  marker: z.looseObject({ since: time.nullable(), reason: z.string().nullable() }).nullable(),
});
export const ImageMarkerForgotten = z.looseObject({ success: z.literal(true), removed: whole, hint: z.string() });

/** Diagnostics for the admin: the UI shows their fields raw. */
export const Diagnose = z.record(z.string(), z.unknown());
export const Endpoints = z.looseObject({
  auth: z.record(z.string(), z.unknown()).optional(),
  api: z.string(),
  version: z.string(),
  endpoints: z.record(z.string(), z.unknown()),
});

/** The admin's bulk responses with what the individual route says about it. */
export const AdminMessage = GenericAdminResponse.extend({ message: z.string() });
/** Instructions re-queued; without missing ones, `message` says why none. */
export const InstructionsEnqueued = GenericAdminResponse.extend({ enqueued: whole, message: z.string().optional() });
export const CatalogImagesEnqueued = GenericAdminResponse.extend({
  queued: whole,
  pending: whole,
  skipped: whole,
  discarded: whole,
  duration_minutes: whole,
});
export const AdminStarted = GenericAdminResponse.extend({ started: z.boolean() });
export const AdminSet = GenericAdminResponse.extend({ set_number: z.string() });
export const AdminTtl = GenericAdminResponse.extend({ ttl: z.union([z.string(), whole]) });
export const AdminCondition = GenericAdminResponse.extend({ condition: z.string().nullable() });
export const AdminTheme = GenericAdminResponse.extend({ theme: z.string() });

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(JobProgress, { done: 'erledigt', total: 'gesamt' });
v1Keys(JobCounter, { count: 'anzahl' });
v1Keys(JobProcess, { running: 'laeuft' });
v1Keys(JobQueueResponse, { jobs: 'auftraege' });
v1Keys(JobKindDrain, { removed: 'entfernt' });
v1Keys(JobKindStart, { started: 'gestartet' });
v1Keys(JobStatus.shape.sub_parts.unwrap().element, { values: 'werte' });
v1Keys(JobsResponse.shape.proxy_hint.unwrap().unwrap().shape.vars, { minutes: 'minuten', count: 'anzahl' });
v1Keys(LogEntries, { entries: 'eintraege' });
v1Keys(ImageDiagnosis.shape.local.shape.original, { changed: 'geaendert' });
v1Keys(ImageDiagnosis.shape.local.shape.preview, { changed: 'geaendert' });
v1Keys(ImageDiagnosis.shape.marker.unwrap(), { since: 'seit', reason: 'grund' });
v1Keys(ImageMarkerForgotten, { removed: 'entfernt' });

export const routes = {
  // The rows of a running import: as many as the one file has.
  'GET /api/v2/sets/import/csv/status': { small: true, response: CsvImportStatus },
  'GET /api/v2/sets/import/csv/stream': {
    kind: 'stream',
    event: CsvImportStatus,
    query: v1Keys(query({ language: Q.text(2) }), { language: 'sprache' }),
  },
  'GET /api/v2/admin/logs': { small: true, response: LogResponse, query: query({ minutes: Q.number() }) },
  'GET /api/v2/admin/jobs': { response: JobsResponse, small: true },
  'GET /api/v2/admin/brickset-queue': { response: BricksetQueueResponse, query: query(PAGE) },
  'GET /api/v2/admin/cache-stats': { response: CacheStatsResponse, small: true },
  'GET /api/v2/admin/cache-ttl': { response: CacheTtlResponse },
  'GET /api/v2/admin/api-limits': { response: ApiLimitsResponse },
  'GET /api/v2/admin/job-queue': {
    small: true,
    response: JobQueueResponse,
    query: query({ status: v1Values(Q.text(20), V1_JOB_STATUS), kind: v1Values(Q.text(40), V1_JOB_KINDS) }),
  },
  'POST /api/v2/sets/import/csv/cancel': { input: WITHOUT_BODY, response: GenericAdminResponse },
  'POST /api/v2/admin/job-schedule': {
    input: z.strictObject({
      name: TEXT(40),
      time: TEXT(5).nullable().optional(),
      minutes: GLOBAL_RULES.price_job_interval_minutes.nullable().optional(),
    }),
    response: GenericAdminResponse,
  },
  'POST /api/v2/admin/catalog-images': {
    input: z.strictObject({ all_again: YES_NO.optional() }),
    response: CatalogImagesEnqueued,
  },
  'POST /api/v2/admin/brickset-queue/:setNumber/retry': { input: WITHOUT_BODY, response: AdminSet },
  'DELETE /api/v2/admin/brickset-queue/:setNumber': { input: WITHOUT_BODY, response: AdminSet },
  'POST /api/v2/admin/cache-ttl': {
    input: z.strictObject({ ttl: GLOBAL_RULES.price_cache_ttl }),
    response: AdminTtl,
  },
  'POST /api/v2/admin/cache-clear': {
    input: z.strictObject({ all: YES_NO.optional() }),
    response: AdminMessage,
  },
  'PUT /api/v2/admin/api-limits': {
    input: z.strictObject({
      rebrickable: GLOBAL_RULES.api_limit_rebrickable.optional(),
      bricklink: GLOBAL_RULES.api_limit_bricklink.optional(),
      brickset: GLOBAL_RULES.api_limit_brickset.optional(),
    }),
    response: GenericAdminResponse,
  },
  'POST /api/v2/admin/redownload-missing-images': { input: WITHOUT_BODY, response: AdminStarted },
  'POST /api/v2/admin/job-queue/:id/cancel': { input: WITHOUT_BODY, response: JobChange },
  'POST /api/v2/admin/job-queue/:id/retry': { input: WITHOUT_BODY, response: JobChange },
  'POST /api/v2/admin/job-queue/kind/:kind/now': { input: WITHOUT_BODY, response: JobKindStart },
  'DELETE /api/v2/admin/job-queue/kind/:kind': { input: WITHOUT_BODY, response: JobKindDrain },
  'POST /api/v2/admin/trigger-csv-sync': { input: WITHOUT_BODY, response: AdminMessage },
  'POST /api/v2/admin/reimport-instructions': { input: WITHOUT_BODY, response: InstructionsEnqueued },
  'POST /api/v2/admin/trigger-price-job': { input: WITHOUT_BODY, response: AdminStarted },
  'POST /api/v2/admin/default-condition': {
    input: z.strictObject({ condition: GLOBAL_RULES.default_price_condition }),
    response: AdminCondition,
  },
  'GET /api/v2/admin/job-status': { response: PriceJobState },
  'GET /api/v2/admin/audit-log': { small: true, response: LogEntries },
  'GET /api/v2/admin/image-diag/:setNumber': { small: true, response: ImageDiagnosis },
  'POST /api/v2/admin/forget-image-misses': {
    input: z.strictObject({ set_numbers: z.array(TEXT(40)).max(10_000).optional(), thumbs: YES_NO.optional() }),
    response: ImageMarkerForgotten,
  },
  'POST /api/v2/admin/img-probe': { response: Diagnose, input: z.strictObject({ url: TEXT(2048).optional() }) },
  'POST /api/v2/admin/price-probe': {
    response: Diagnose,
    input: z.strictObject({ set: TEXT(64).optional(), live: z.boolean().optional() }),
  },
  'GET /api/v2/': { response: Endpoints },
} satisfies Record<string, Route>;
