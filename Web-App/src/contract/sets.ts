import { z } from 'zod';
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

export { GenericResponse, SetMinifigsResponse as SetFigurenResponse, SetPartsResponse as SetTeileResponse };

export const AddSetResponse = z.looseObject({
  success: z.boolean(),
  action: z.string(),
  set_number: z.string(),
  name: z.string().nullable().optional(),
  katalog_offen: z.boolean().optional(),
  /** ausstehend: created, a job is still fetching catalog, image or market price. */
  ergaenzung: z.enum(['ausstehend', 'erledigt']).optional(),
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
  unsicher: z.boolean(),
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
  direction: z.string(),
  threshold: z.number(),
  currency_code: z.string(),
  triggered: z.boolean(),
  last_triggered_at: time.nullable(),
  last_price: z.number().nullable(),
  name: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  set_img_url: z.string().nullable().optional(),
  besitzt: z.boolean(),
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
  letzter_kauf: time.nullable().optional(),
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
  kaufpreis_geschaetzt: z.boolean().nullable().optional(),
  used_count: z.number().int(),
  instructions: z.array(Instruction),
  bricklink: BrickLinkRef.nullable().optional(),
  preisvergleich_url: z.string().nullable().optional(),
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
  im_katalog: z.boolean(),
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

/** 202: loading happens in the job process (job `anleitung`); the list is the state before loading. */
export const InstructionsLoaded = z.looseObject({
  success: z.literal(true),
  count: whole,
  instructions: z.array(Instruction),
  auftrag_id: z.string().nullable(),
});
export const PdfAuftrag = z.looseObject({ success: z.literal(true), jobId: z.string() });

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
export const PdfStand = z.looseObject({
  success: z.literal(true),
  status: z.string(),
  error: z.string().nullable(),
  etaSeconds: z.number().nullable(),
  missingImages: z.unknown(),
});

/** The set import runs in the background; right away it is known how many rows and which sets already exist. */
export const SetCsvImportGestartet = z.looseObject({
  success: z.boolean(),
  total: whole,
  /** false for `pruefen`: only counted, nothing started. */
  gestartet: z.boolean(),
  vorhanden: whole,
  vorhanden_nummern: z.array(z.string()),
  skipped: whole.optional(),
  skipped_hint: z.string().optional(),
});

export const PartsLoaded = z.looseObject({ success: z.literal(true), count: whole });

export const AnleitungHochgeladen = GenericResponse.extend({
  instruction: z.looseObject({ url: z.string(), description: z.string().nullable(), local_path: z.string() }),
});

/** What a reduction removed; the UI names the purchase and offers undo via `papierkorb`. */
export const QuantityChanged = GenericResponse.extend({
  /** null: written but not read back (see degradiert). */
  quantity: whole.nullable(),
  papierkorb: z.number().int().optional(),
  degradiert: DEGRADED,
  entfallen: z
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
  quantity: input.stueckzahl(),
  purchase_price: input.geld('Kaufpreis'),
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

export const routen = {
  'GET /api/v1/sets/info/:setNumber': { antwort: SetInfoResponse },
  'GET /api/v1/sets': {
    antwort: SetsResponse,
    abfrage: query({
      accounts: Q.konten,
      search: Q.text(),
      theme: Q.text(),
      sort: Q.text(40),
      page: Q.zahl(),
      page_size: Q.zahl(),
      storage: Q.text(),
    }),
  },
  'GET /api/v1/sets/:setNumber': { antwort: SetResponse, abfrage: query({ accounts: Q.konten }) },
  'GET /api/v1/alerts/pending': {
    klein: true,
    antwort: PendingAlertsResponse,
    abfrage: query({ since: Q.text(40) }),
  },
  'GET /api/v1/alerts': { klein: true, antwort: PriceAlertsResponse },
  'GET /api/v1/sets/:setNumber/alert': { klein: true, antwort: PriceAlertsResponse },
  'GET /api/v1/sets/:setNumber/parts-list': { klein: true, antwort: SetPartsResponse },
  'GET /api/v1/sets/:setNumber/minifigs-list': { klein: true, antwort: SetMinifigsResponse },
  'GET /api/v1/sets/exists/:setNumber': { antwort: SetExistsResponse },
  'GET /api/v1/sets/barcode/:barcode': { antwort: BarcodeResponse },
  'POST /api/v1/sets/:setNumber/instructions/upload': {
    antwort: AnleitungHochgeladen,
    formular: true,
    eingabe: z.strictObject({ description: TEXT(500).optional() }),
  },
  'DELETE /api/v1/sets/:setNumber/instructions/:instrId': { eingabe: WITHOUT_BODY, antwort: GenericResponse },
  'POST /api/v1/sets': { antwort: AddSetResponse, eingabe: NewSet },
  'PUT /api/v1/sets/:setNumber': {
    eingabe: z.strictObject({
      quantity: input.quantityOrNothing(0, 100_000).optional(),
      quantity_delta: input.quantitiesDelta(),
      purchase_price: input.geld('Kaufpreis'),
      condition: CONDITION.nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
    }),
    antwort: QuantityChanged,
  },
  'DELETE /api/v1/sets/:setNumber': {
    eingabe: WITHOUT_BODY,
    antwort: MovedToTrash,
    abfrage: query({ accounts: Q.konten }),
  },
  'PUT /api/v1/sets/:setNumber/alert': {
    eingabe: z.strictObject({
      direction: z.enum(['unter', 'ueber']),
      threshold: input.geld('Schwelle', { nullbar: false }),
      condition: CONDITION.optional(),
    }),
    antwort: PriceAlertResponse,
  },
  'DELETE /api/v1/sets/:setNumber/alert': {
    eingabe: WITHOUT_BODY,
    antwort: PriceAlertResponse,
    abfrage: query({ condition: z.enum(['N', 'U', 'n', 'u']) }),
  },
  'POST /api/v1/sets/:sn/move': {
    eingabe: z.strictObject({
      from_user_id: IDENTIFIER.nullable().optional(),
      to_user_id: IDENTIFIER,
      acquisition_ids: z.array(IDENTIFIER).max(10_000).nullable().optional(),
    }),
    antwort: MoveSetResponse,
  },
  'POST /api/v1/sets/import/csv': {
    formular: true,
    antwort: SetCsvImportGestartet,
    abfrage: query({ pruefen: Q.schalter }),
  },
  'POST /api/v1/alerts/import/csv': { formular: true, antwort: CsvImportResult },
  'POST /api/v1/sets/:setNumber/instructions': { eingabe: WITHOUT_BODY, antwort: InstructionsLoaded },
  'POST /api/v1/sets/partslist-pdf': { antwort: PdfAuftrag, eingabe: PdfInput },
  'GET /api/v1/sets/partslist-pdf/status/:jobId': { antwort: PdfStand },
  'GET /api/v1/sets/partslist-pdf/download/:jobId': { art: 'pdf' },
  'GET /api/v1/sets/partslist-pdf/stream/:jobId': { art: 'strom', ereignis: PdfStand },
  'POST /api/v1/sets/add-stream': { art: 'strom', eingabe: NewSet },
  'GET /api/v1/sets/export/rebrickable': { art: 'csv' },
  'POST /api/v1/sets/:setNumber/parts': { eingabe: WITHOUT_BODY, antwort: PartsLoaded },
} satisfies Record<string, Route>;
