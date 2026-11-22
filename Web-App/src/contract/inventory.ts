import { z } from 'zod';
import { input } from '../infra/validate';
import {
  type Route,
  time,
  Success,
  whole,
  confirmed,
  WITHOUT_BODY,
  IDENTIFIER,
  TEXT,
  CONDITION,
  query,
  Q,
} from './base';
/** One account or several, separated by commas (storage locations via the household). */
const STORAGE_ACCOUNTS = z.string().regex(/^[0-9,]{0,200}$/);
import { DEGRADED, AcquisitionReply } from './shared';

export { AcquisitionReply as Erfassungsantwort };

export const Acquisition = z.looseObject({
  id: z.number().int(),
  quantity: z.number().int(),
  purchase_price: z.number().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  condition: z.string(),
  created_at: time.nullable(),
  owner_user_id: z.number().int(),
  price_estimated: z.boolean(),
  currency: z.string().nullable(),
  /** The price in the account's currency (rate of the purchase day); null without a price or without a rate. */
  preis_konto: z.number().nullable(),
});

export const AcquisitionTotals = z.looseObject({
  quantity: z.number().int(),
  /** Sum in `currency`; foreign currencies converted, not included without a rate. Missing without a price. */
  amount: z.number().optional(),
  priced_rows: z.number().int(),
  currency: z.string().optional(),
  ohne_kurs: z.number().int().optional(),
});

export const AcquisitionsResponse = z.looseObject({
  success: z.boolean(),
  /** The asking account; missing if reading failed. */
  owner_user_id: z.number().int().optional(),
  acquisitions: z.array(Acquisition),
  totals: AcquisitionTotals,
  degradiert: DEGRADED,
});

export const DeleteWithQuantityResponse = z.looseObject({
  success: z.boolean(),
  new_quantity: z.number().int().optional(),
});

export const Storage = z.looseObject({
  figuren: z.number().int().nullable(),
  ort: z.string(),
  sets: z.number().int(),
  teile: z.number().int(),
});

export const StorageEntry = z.looseObject({
  id: z.number().int(),
  user_id: z.number().int(),
  name: z.string(),
});

export const StorageEntryResponse = z.looseObject({
  success: z.boolean(),
  ort: StorageEntry.nullable(),
});

export const StorageResponse = z.looseObject({
  success: z.boolean(),
  storage: z.string().nullable().optional(),
  changed: z.number().int().optional(),
});

export const StorageDefaultResponse = z.looseObject({
  success: z.boolean(),
  vorgabe: StorageEntry.nullable(),
});

export const StorageStockResponse = z.looseObject({
  success: z.boolean(),
  orte: z.array(StorageEntry),
  vorgabe: StorageEntry.nullable(),
});

export const StoragesResponse = z.looseObject({
  success: z.boolean(),
  orte: z.array(Storage),
});

export const TrashEntry = z.looseObject({
  id: whole,
  type: z.enum(['set', 'teil', 'figur']),
  number: z.string(),
  color_id: whole.nullable(),
  label: z.string().nullable(),
  anzahl: whole,
  user_id: whole,
  deleted_at: time,
  endgueltig_am: time,
});
export const Trash = z.looseObject({ success: z.literal(true), eintraege: z.array(TrashEntry) });
export const Restored = z.looseObject({
  success: z.literal(true),
  type: z.enum(['set', 'teil', 'figur']),
  number: z.string(),
  user_id: whole,
});
export const TrashEmptied = z.looseObject({ success: z.literal(true), entfernt: whole });
/** What "empty inventory" put into the trash, with the identifiers for restoring. */
export const HoldingCleared = z.looseObject({
  success: z.literal(true),
  sets: whole,
  teile: whole,
  figuren: whole,
  papierkorb: z.array(whole),
});

/** The price is called purchase_price for sets, otherwise unit_price; the app sends both. */
const AcquisitionChange = z.strictObject({
  quantity: input.quantityOrNothing(1, 100_000),
  purchase_price: input.geld('Kaufpreis'),
  unit_price: input.geld('Stückpreis'),
  condition: CONDITION.nullable().optional(),
  date: TEXT(40).nullable().optional(),
  owner_user_id: IDENTIFIER.nullable().optional(),
  from_user_id: IDENTIFIER.nullable()
    .optional()
    .meta({ deprecated: true, description: 'not evaluated: the owner comes from the row' }),
});

export const routen = {
  'GET /api/v1/sets/:setNumber/acquisitions': {
    klein: true,
    antwort: AcquisitionsResponse,
    abfrage: query({ accounts: Q.konten }),
  },
  'GET /api/v1/parts/:partNumber/:colorId/acquisitions': {
    klein: true,
    antwort: AcquisitionsResponse,
    abfrage: query({ accounts: Q.konten }),
  },
  'GET /api/v1/minifigs/:figNumber/acquisitions': {
    klein: true,
    antwort: AcquisitionsResponse,
    abfrage: query({ accounts: Q.konten }),
  },
  'GET /api/v1/storage/locations': {
    klein: true,
    antwort: StorageStockResponse,
    abfrage: query({
      owner: STORAGE_ACCOUNTS,
      accounts: Q.konten.meta({ deprecated: true, description: 'not evaluated: the list follows the permission' }),
    }),
  },
  'GET /api/v1/storage': { klein: true, antwort: StoragesResponse, abfrage: query({ accounts: Q.konten }) },
  'PUT /api/v1/minifigs/:figNumber/storage': {
    eingabe: z.strictObject({ storage: TEXT().nullable().optional() }),
    antwort: StorageResponse,
  },
  'PUT /api/v1/sets/:setNumber/acquisitions/:acqId': { antwort: AcquisitionReply, eingabe: AcquisitionChange },
  'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId': { eingabe: WITHOUT_BODY, antwort: AcquisitionReply },
  'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': {
    antwort: AcquisitionReply,
    eingabe: AcquisitionChange,
  },
  'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': {
    eingabe: WITHOUT_BODY,
    antwort: DeleteWithQuantityResponse,
  },
  'PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId': { antwort: AcquisitionReply, eingabe: AcquisitionChange },
  'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId': {
    eingabe: WITHOUT_BODY,
    antwort: DeleteWithQuantityResponse,
  },
  'PUT /api/v1/sets/:setNumber/storage': {
    eingabe: z.strictObject({ storage: TEXT().nullable().optional() }),
    antwort: StorageResponse,
  },
  'PUT /api/v1/parts/:partNumber/:colorId/storage': {
    eingabe: z.strictObject({ storage: TEXT().nullable().optional() }),
    antwort: StorageResponse,
  },
  'POST /api/v1/storage/locations': {
    eingabe: z.strictObject({ name: TEXT().optional(), owner: IDENTIFIER.optional() }),
    antwort: StorageEntryResponse,
    abfrage: query({ owner: STORAGE_ACCOUNTS }),
  },
  'PUT /api/v1/storage/locations/:id': {
    eingabe: z.strictObject({ name: TEXT().optional(), owner: IDENTIFIER.optional() }),
    antwort: StorageEntryResponse,
    abfrage: query({ owner: STORAGE_ACCOUNTS }),
  },
  'DELETE /api/v1/storage/locations/:id': {
    eingabe: WITHOUT_BODY,
    antwort: StorageResponse,
    abfrage: query({ owner: STORAGE_ACCOUNTS }),
  },
  'PUT /api/v1/storage/default': {
    eingabe: z.strictObject({ id: IDENTIFIER.nullable().optional() }),
    antwort: StorageDefaultResponse,
  },
  'GET /api/v1/papierkorb': { klein: true, antwort: Trash },
  'POST /api/v1/papierkorb/:id/wiederherstellen': { eingabe: WITHOUT_BODY, antwort: Restored },
  'DELETE /api/v1/papierkorb/:id': { antwort: Success, ...confirmed() },
  'DELETE /api/v1/papierkorb': { antwort: TrashEmptied, ...confirmed() },
  'DELETE /api/v1/bestand': { antwort: HoldingCleared, ...confirmed() },
} satisfies Record<string, Route>;
