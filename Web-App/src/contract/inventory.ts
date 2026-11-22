import { z } from 'zod';
import { v1Keys } from './v1';
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

export { AcquisitionReply };

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
  account_price: z.number().nullable(),
});

export const AcquisitionTotals = z.looseObject({
  quantity: z.number().int(),
  /** Sum in `currency`; foreign currencies converted, not included without a rate. Missing without a price. */
  amount: z.number().optional(),
  priced_rows: z.number().int(),
  currency: z.string().optional(),
  without_rate: z.number().int().optional(),
});

export const AcquisitionsResponse = z.looseObject({
  success: z.boolean(),
  /** The asking account; missing if reading failed. */
  owner_user_id: z.number().int().optional(),
  acquisitions: z.array(Acquisition),
  totals: AcquisitionTotals,
  degraded: DEGRADED,
});

export const DeleteWithQuantityResponse = z.looseObject({
  success: z.boolean(),
  new_quantity: z.number().int().optional(),
});

export const Storage = z.looseObject({
  minifigs: z.number().int().nullable(),
  location: z.string(),
  sets: z.number().int(),
  parts: z.number().int(),
});

export const StorageEntry = z.looseObject({
  id: z.number().int(),
  user_id: z.number().int(),
  name: z.string(),
});

export const StorageEntryResponse = z.looseObject({
  success: z.boolean(),
  location: StorageEntry.nullable(),
});

export const StorageResponse = z.looseObject({
  success: z.boolean(),
  storage: z.string().nullable().optional(),
  changed: z.number().int().optional(),
});

export const StorageDefaultResponse = z.looseObject({
  success: z.boolean(),
  preset: StorageEntry.nullable(),
});

export const StorageStockResponse = z.looseObject({
  success: z.boolean(),
  locations: z.array(StorageEntry),
  preset: StorageEntry.nullable(),
});

export const StoragesResponse = z.looseObject({
  success: z.boolean(),
  locations: z.array(Storage),
});

export const TrashEntry = z.looseObject({
  id: whole,
  type: z.enum(['set', 'teil', 'figur']),
  number: z.string(),
  color_id: whole.nullable(),
  label: z.string().nullable(),
  count: whole,
  user_id: whole,
  deleted_at: time,
  purge_at: time,
});
export const Trash = z.looseObject({ success: z.literal(true), entries: z.array(TrashEntry) });
export const Restored = z.looseObject({
  success: z.literal(true),
  type: z.enum(['set', 'teil', 'figur']),
  number: z.string(),
  user_id: whole,
});
export const TrashEmptied = z.looseObject({ success: z.literal(true), removed: whole });
/** What "empty inventory" put into the trash, with the identifiers for restoring. */
export const HoldingCleared = z.looseObject({
  success: z.literal(true),
  sets: whole,
  parts: whole,
  minifigs: whole,
  trash: z.array(whole),
});

/** The price is called purchase_price for sets, otherwise unit_price; the app sends both. */
const AcquisitionChange = z.strictObject({
  quantity: input.quantityOrNothing(1, 100_000),
  purchase_price: input.money('Kaufpreis'),
  unit_price: input.money('Stückpreis'),
  condition: CONDITION.nullable().optional(),
  date: TEXT(40).nullable().optional(),
  owner_user_id: IDENTIFIER.nullable().optional(),
  from_user_id: IDENTIFIER.nullable()
    .optional()
    .meta({ deprecated: true, description: 'not evaluated: the owner comes from the row' }),
});

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(Storage, { minifigs: 'figuren', parts: 'teile' });
v1Keys(TrashEntry, { count: 'anzahl' });
v1Keys(Trash, { entries: 'eintraege' });
v1Keys(TrashEmptied, { removed: 'entfernt' });
v1Keys(HoldingCleared, { minifigs: 'figuren', parts: 'teile' });

export const routes = {
  'GET /api/v2/sets/:setNumber/acquisitions': {
    small: true,
    response: AcquisitionsResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/parts/:partNumber/:colorId/acquisitions': {
    small: true,
    response: AcquisitionsResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/minifigs/:figNumber/acquisitions': {
    small: true,
    response: AcquisitionsResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/storage/locations': {
    small: true,
    response: StorageStockResponse,
    query: query({
      owner: STORAGE_ACCOUNTS,
      accounts: Q.accounts.meta({ deprecated: true, description: 'not evaluated: the list follows the permission' }),
    }),
  },
  'GET /api/v2/storage': { small: true, response: StoragesResponse, query: query({ accounts: Q.accounts }) },
  'PUT /api/v2/minifigs/:figNumber/storage': {
    input: z.strictObject({ storage: TEXT().nullable().optional() }),
    response: StorageResponse,
  },
  'PUT /api/v2/sets/:setNumber/acquisitions/:acqId': { response: AcquisitionReply, input: AcquisitionChange },
  'DELETE /api/v2/sets/:setNumber/acquisitions/:acqId': { input: WITHOUT_BODY, response: AcquisitionReply },
  'PUT /api/v2/parts/:partNumber/:colorId/acquisitions/:acqId': {
    response: AcquisitionReply,
    input: AcquisitionChange,
  },
  'DELETE /api/v2/parts/:partNumber/:colorId/acquisitions/:acqId': {
    input: WITHOUT_BODY,
    response: DeleteWithQuantityResponse,
  },
  'PUT /api/v2/minifigs/:figNumber/acquisitions/:acqId': { response: AcquisitionReply, input: AcquisitionChange },
  'DELETE /api/v2/minifigs/:figNumber/acquisitions/:acqId': {
    input: WITHOUT_BODY,
    response: DeleteWithQuantityResponse,
  },
  'PUT /api/v2/sets/:setNumber/storage': {
    input: z.strictObject({ storage: TEXT().nullable().optional() }),
    response: StorageResponse,
  },
  'PUT /api/v2/parts/:partNumber/:colorId/storage': {
    input: z.strictObject({ storage: TEXT().nullable().optional() }),
    response: StorageResponse,
  },
  'POST /api/v2/storage/locations': {
    input: z.strictObject({ name: TEXT().optional(), owner: IDENTIFIER.optional() }),
    response: StorageEntryResponse,
    query: query({ owner: STORAGE_ACCOUNTS }),
  },
  'PUT /api/v2/storage/locations/:id': {
    input: z.strictObject({ name: TEXT().optional(), owner: IDENTIFIER.optional() }),
    response: StorageEntryResponse,
    query: query({ owner: STORAGE_ACCOUNTS }),
  },
  'DELETE /api/v2/storage/locations/:id': {
    input: WITHOUT_BODY,
    response: StorageResponse,
    query: query({ owner: STORAGE_ACCOUNTS }),
  },
  'PUT /api/v2/storage/default': {
    input: z.strictObject({ id: IDENTIFIER.nullable().optional() }),
    response: StorageDefaultResponse,
  },
  'GET /api/v2/trash': { small: true, response: Trash },
  'POST /api/v2/trash/:id/restore': { input: WITHOUT_BODY, response: Restored },
  'DELETE /api/v2/trash/:id': { response: Success, ...confirmed() },
  'DELETE /api/v2/trash': { response: TrashEmptied, ...confirmed() },
  'DELETE /api/v2/inventory': { response: HoldingCleared, ...confirmed() },
} satisfies Record<string, Route>;
