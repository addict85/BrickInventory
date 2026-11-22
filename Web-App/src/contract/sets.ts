import { z } from 'zod';
import { V1_ALERT_DIRECTIONS, V1_SUPPLEMENT, V1_SET_SORTS } from './v1Names';
import { v1Keys, v1Values } from './v1';
import { input, LARGEST_ID } from '../infra/validate';
import { AccountName, type Route, time, whole, WITHOUT_BODY, IDENTIFIER, CONDITION, TEXT, query, Q } from './base';
import {
  BrickLinkRef,
  CsvImportResult,
  DEGRADED,
  GenericResponse,
  SetMinifigsResponse,
  SetPartsResponse,
  MovedToTrash,
} from './shared';

export { GenericResponse, SetMinifigsResponse, SetPartsResponse };

export const AddSetResponse = z.looseObject({
  success: z.boolean(),
  action: z.string(),
  set_number: z.string(),
  name: z.string().nullable().optional(),
  catalog_pending: z.boolean().optional(),
  /** pending: created, a job is still fetching catalog, image or market price. */
  supplement: v1Values(z.enum(['pending', 'done']), V1_SUPPLEMENT).optional(),
  owner_user_id: z.number().int().optional(),
  is_self: z.boolean().optional(),
});

export const BarcodeResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  pieces: z.number().int().nullable(),
  theme: z.string().nullable(),
  minifigs: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  source: z.string().nullable(),
  uncertain: z.boolean(),
});

export const Instruction = z.looseObject({
  downloaded_at: time.nullable().optional(),
  fetched_at: time.nullable().optional(),
  set_number: z.string(),
  user_id: z.number().int().nullable().optional(),
  id: z.number().int(),
  url: z.string(),
  description: z.string().nullable(),
  local_path: z.string().nullable(),
  is_manual: z.boolean(),
});

export const MoveSetResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  quantity: z.number().int(),
  acquisitions: z.number().int(),
  merged: z.boolean(),
  parts: z.number().int(),
  minifigs: z.number().int(),
  instructions: z.number().int(),
  source_emptied: z.boolean(),
  from_user_id: z.number().int(),
  to_user_id: z.number().int(),
});

export const PriceAlert = z.looseObject({
  set_number: z.string(),
  condition: z.string(),
  direction: v1Values(z.string(), V1_ALERT_DIRECTIONS),
  threshold: z.number(),
  currency_code: z.string(),
  triggered: z.boolean(),
  last_triggered_at: time.nullable(),
  last_price: z.number().nullable(),
  name: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  set_img_url: z.string().nullable().optional(),
  owns: z.boolean(),
});

export const PendingAlertsResponse = z.looseObject({
  success: z.boolean(),
  alerts: z.array(PriceAlert),
  now: time.nullable(),
});

export const PriceAlertResponse = z.looseObject({
  success: z.boolean(),
  alert: PriceAlert.nullable().optional(),
  removed: z.number().int().optional(),
});

export const PriceAlertsResponse = z.looseObject({
  success: z.boolean(),
  alerts: z.array(PriceAlert),
});

export const SetItem = z.looseObject({
  acq_count: z.number().int(),
  last_purchase: time.nullable().optional(),
  owner_ids: z.array(z.number().int()).optional(),
  id: z.number().int().optional(),
  storage_id: z.number().int().nullable().optional(),
  updated_at: time.nullable().optional(),
  user_id: z.number().int().optional(),
  set_number: z.string(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  theme: z.string().nullable(),
  pieces: z.number().int().nullable(),
  minifigs: z.number().int().nullable(),
  quantity: z.number().int(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  added_at: time.nullable(),
  condition: z.string().nullable(),
  storage: z.string().nullable(),
  conditions: z.array(z.string()),
  /** Only in the household (besitzerAnhaengen); alone there are no owners to name. */
  owners: z.array(AccountName).optional(),
  max_purchase_price: z.number().nullable(),
  avg_purchase_price: z.number().nullable(),
  purchase_price_estimated: z.boolean().nullable().optional(),
  used_count: z.number().int(),
  instructions: z.array(Instruction),
  bricklink: BrickLinkRef.nullable().optional(),
  price_comparison_url: z.string().nullable().optional(),
});

export const SetExistsResponse = z.looseObject({
  success: z.boolean(),
  exists: z.boolean(),
  set_number: z.string(),
  owner_user_id: z.number().int().nullable().optional(),
  /** Only if the set exists in the scope. */
  is_self: z.boolean().optional(),
});

export const SetInfoResponse = z.looseObject({
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  minifigs: z.number().int().nullable().optional(),
  pieces: z.number().int().nullable().optional(),
  theme: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  success: z.boolean(),
  set_number: z.string(),
  name: z.string().nullable(),
  in_catalog: z.boolean(),
});

export const SetResponse = z.looseObject({
  success: z.boolean(),
  set: SetItem.nullable(),
});

export const SetsResponse = z.looseObject({
  success: z.boolean(),
  count: z.number().int(),
  sets: z.array(SetItem),
  total: z.number().int(),
  /** Only on the first page of a paged fetch. */
  themes: z.array(z.string()).optional(),
});

/** 202: loading happens in the job process (job `instructions`); the list is the state before loading. */
export const InstructionsLoaded = z.looseObject({
  success: z.literal(true),
  count: whole,
  instructions: z.array(Instruction),
  job_id: z.string().nullable(),
});
export const PdfJob = z.looseObject({ success: z.literal(true), jobId: z.string() });

const textOrNull = (max: number) => z.string().max(max).nullish();
/** The job draws every row and loads images: number and size are limited. */
export const PdfInput = z.strictObject({
  sets: z
    .array(z.object({ set_number: z.string().trim().min(1).max(32), name: textOrNull(500) }))
    .max(1000)
    .optional(),
  parts: z
    .array(
      z.object({
        part_number: z.string().trim().min(1).max(64),
        bl_part_number: textOrNull(64),
        part_name: textOrNull(500),
        color_name: textOrNull(100),
        color_hex: z
          .string()
          .regex(/^#?[0-9A-Fa-f]{0,8}$/)
          .nullish(),
        color_id: z.number().int().min(-1).max(LARGEST_ID).nullish(),
        quantity: z.union([z.number().int().min(1).max(9999), z.string().regex(/^[1-9]\d{0,3}$/)]),
        is_fig: z.union([z.boolean(), z.number()]).nullish(),
        image_url: textOrNull(2048),
        image_local: textOrNull(512),
      }),
    )
    .max(5000)
    .optional(),
});
/** The state of a PDF job; the app polls it until it is finished. */
export const PdfState = z.looseObject({
  success: z.literal(true),
  status: z.string(),
  error: z.string().nullable(),
  etaSeconds: z.number().nullable(),
  missingImages: z.unknown(),
});

/** The set import runs in the background; right away it is known how many rows and which sets already exist. */
export const SetCsvImportStarted = z.looseObject({
  success: z.boolean(),
  total: whole,
  /** false for `pruefen`: only counted, nothing started. */
  started: z.boolean(),
  existing: whole,
  existing_numbers: z.array(z.string()),
  skipped: whole.optional(),
  skipped_hint: z.string().optional(),
});

export const PartsLoaded = z.looseObject({ success: z.literal(true), count: whole });

export const InstructionUploaded = GenericResponse.extend({
  instruction: z.looseObject({ url: z.string(), description: z.string().nullable(), local_path: z.string() }),
});

/** What a reduction removed; the UI names the purchase and offers undo via `papierkorb`. */
export const QuantityChanged = GenericResponse.extend({
  /** null: written but not read back (see degradiert). */
  quantity: whole.nullable(),
  trash: z.number().int().optional(),
  degraded: DEGRADED,
  dropped: z
    .array(
      z.looseObject({
        id: whole,
        quantity: whole,
        purchase_price: z.number().nullable(),
        currency: z.string().nullable(),
        price_estimated: z.boolean(),
        condition: z.string(),
        date: z.string().nullable(),
      }),
    )
    .optional(),
});

/** A new set; the same fields for the stream (add-stream). */
const NewSet = z.strictObject({
  set_number: z.union([z.string().max(64), z.number()]).optional(),
  quantity: input.pieceCount(),
  purchase_price: input.money('Kaufpreis'),
  condition: CONDITION.nullable().optional(),
  owner_user_id: IDENTIFIER.nullable().optional(),
  storage: TEXT().nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(SetCsvImportStarted, { started: 'gestartet' });

export const routes = {
  'GET /api/v2/sets/info/:setNumber': { response: SetInfoResponse },
  'GET /api/v2/sets': {
    response: SetsResponse,
    query: query({
      accounts: Q.accounts,
      search: Q.text(),
      theme: Q.text(),
      sort: v1Values(Q.text(40), V1_SET_SORTS),
      page: Q.number(),
      page_size: Q.number(),
      storage: Q.text(),
    }),
  },
  'GET /api/v2/sets/:setNumber': { response: SetResponse, query: query({ accounts: Q.accounts }) },
  'GET /api/v2/alerts/pending': {
    small: true,
    response: PendingAlertsResponse,
    query: query({ since: Q.text(40) }),
  },
  'GET /api/v2/alerts': { small: true, response: PriceAlertsResponse },
  'GET /api/v2/sets/:setNumber/alert': { small: true, response: PriceAlertsResponse },
  'GET /api/v2/sets/:setNumber/parts-list': { small: true, response: SetPartsResponse },
  'GET /api/v2/sets/:setNumber/minifigs-list': { small: true, response: SetMinifigsResponse },
  'GET /api/v2/sets/exists/:setNumber': { response: SetExistsResponse },
  'GET /api/v2/sets/barcode/:barcode': { response: BarcodeResponse },
  'POST /api/v2/sets/:setNumber/instructions/upload': {
    response: InstructionUploaded,
    form: true,
    input: z.strictObject({ description: TEXT(500).optional() }),
  },
  'DELETE /api/v2/sets/:setNumber/instructions/:instrId': { input: WITHOUT_BODY, response: GenericResponse },
  'POST /api/v2/sets': { response: AddSetResponse, input: NewSet },
  'PUT /api/v2/sets/:setNumber': {
    input: z.strictObject({
      quantity: input.quantityOrNothing(0, 100_000).optional(),
      quantity_delta: input.quantitiesDelta(),
      purchase_price: input.money('Kaufpreis'),
      condition: CONDITION.nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
    }),
    response: QuantityChanged,
  },
  'DELETE /api/v2/sets/:setNumber': {
    input: WITHOUT_BODY,
    response: MovedToTrash,
    query: query({ accounts: Q.accounts }),
  },
  'PUT /api/v2/sets/:setNumber/alert': {
    input: z.strictObject({
      direction: v1Values(z.enum(['below', 'above']), V1_ALERT_DIRECTIONS),
      threshold: input.money('Schwelle', { nullable: false }),
      condition: CONDITION.optional(),
    }),
    response: PriceAlertResponse,
  },
  'DELETE /api/v2/sets/:setNumber/alert': {
    input: WITHOUT_BODY,
    response: PriceAlertResponse,
    query: query({ condition: z.enum(['N', 'U', 'n', 'u']) }),
  },
  'POST /api/v2/sets/:sn/move': {
    input: z.strictObject({
      from_user_id: IDENTIFIER.nullable().optional(),
      to_user_id: IDENTIFIER,
      acquisition_ids: z.array(IDENTIFIER).max(10_000).nullable().optional(),
    }),
    response: MoveSetResponse,
  },
  'POST /api/v2/sets/import/csv': {
    form: true,
    response: SetCsvImportStarted,
    query: query({ check: Q.toggle }),
  },
  'POST /api/v2/alerts/import/csv': { form: true, response: CsvImportResult },
  'POST /api/v2/sets/:setNumber/instructions': { input: WITHOUT_BODY, response: InstructionsLoaded },
  'POST /api/v2/sets/partslist-pdf': { response: PdfJob, input: PdfInput },
  'GET /api/v2/sets/partslist-pdf/status/:jobId': { response: PdfState },
  'GET /api/v2/sets/partslist-pdf/download/:jobId': { kind: 'pdf' },
  'GET /api/v2/sets/partslist-pdf/stream/:jobId': { kind: 'stream', event: PdfState },
  'POST /api/v2/sets/add-stream': { kind: 'stream', input: NewSet },
  'GET /api/v2/sets/export/rebrickable': { kind: 'csv' },
  'POST /api/v2/sets/:setNumber/parts': { input: WITHOUT_BODY, response: PartsLoaded },
} satisfies Record<string, Route>;
