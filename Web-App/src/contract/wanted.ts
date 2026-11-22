import { z } from 'zod';
import { V1_ALERT_DIRECTIONS, V1_RB_ABORTS } from './v1Names';
import { v1Keys, v1Values } from './v1';
import { input } from '../infra/validate';
import {
  type Route,
  time,
  whole,
  WITHOUT_BODY,
  IDENTIFIER,
  TEXT,
  CONDITION,
  query,
  Q,
  PAGE,
  PAGES_DETAIL,
} from './base';
import { CsvImportResult, DEGRADED, GenericResponse } from './shared';

export const CurrentPrice = z.looseObject({
  condition: z.string(),
  avg_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
  fetched_at: time.nullable().optional(),
});

export const CurrentByCondition = z.looseObject({
  N: CurrentPrice.nullable().optional(),
  U: CurrentPrice.nullable().optional(),
});

export const WantedItemAlert = z.looseObject({
  direction: v1Values(z.string(), V1_ALERT_DIRECTIONS),
  threshold: z.number(),
  triggered: z.boolean(),
});

export const WantedItem = z.looseObject({
  theme_id: z.number().int().nullable(),
  set_number: z.string(),
  condition: z.string(),
  created_at: time,
  user_id: z.number().int(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  num_parts: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  market_price: z.number().nullable(),
  currency: z.string(),
  owned: z.boolean(),
  alarm: WantedItemAlert.nullable(),
  price_comparison_url: z.string().nullable(),
});

export const WantedListResponse = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  item: z.array(WantedItem),
});

export const WantedItemReply = z.looseObject({
  success: z.boolean(),
  was_new: z.boolean(),
  item: WantedItem.nullable(),
});

export const WantedItemOwnerReply = z.looseObject({
  success: z.boolean(),
  moved: z.boolean(),
  merged: z.boolean(),
  owner_user_id: z.number().int().nullable(),
});

export const WantedItemPricesResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  currency: z.string(),
  current: CurrentByCondition,
  degraded: DEGRADED,
});

export const WantedItemTakeoverResponse = z.looseObject({
  catalog_pending: z.boolean().optional(),
  name: z.string().nullable().optional(),
  success: z.boolean(),
  action: z.string().nullable(),
  set_number: z.string().nullable(),
});

/** Reading in a BrickLink wanted list; with `vorschau` without saving. */
export const WantedXmlResult = z.looseObject({
  success: z.literal(true),
  preview: z.boolean(),
  parsed: whole,
  created: whole,
  topped_up: whole,
  error: whole,
  items: z.array(
    z.looseObject({
      kind: z.string(),
      blId: z.string(),
      quantity: whole,
      outcome: v1Values(z.string(), { created: 'angelegt', topped_up: 'aufgestockt', open: 'offen', error: 'fehler' }),
      blColor: whole.nullable().optional(),
      rbId: z.string().nullable().optional(),
      rbColor: whole.nullable().optional(),
      colorName: z.string().nullable().optional(),
      colorHex: z.string().nullable().optional(),
      confidence: z.string().nullable().optional(),
      condition: z.string().nullable().optional(),
      maxPrice: z.number().nullable().optional(),
      name: z.string().nullable().optional(),
      nameGuessed: z.boolean().optional(),
      image: z.string().nullable().optional(),
      reason: z.string().nullable().optional(),
      reasonCode: z.string().nullable().optional(),
    }),
  ),
  open: z.array(z.looseObject({ kind: z.string(), blId: z.string(), blColor: whole.nullable().optional() })),
  foreignTypes: z.record(z.string(), whole).optional(),
  withoutNumber: whole.optional(),
  levels: z.record(z.string(), whole).optional(),
  colorPending: whole.optional(),
  defaultCondition: z.string().optional(),
  aborted: z.boolean().optional(),
  corrections: z.looseObject({ applied: whole, rejected: z.array(z.unknown()) }).optional(),
  rebrickable: z
    .looseObject({
      asked: whole,
      found: whole,
      filterIneffective: z.boolean(),
      aborted: v1Values(z.enum(['quota', 'no_key', 'failure']), V1_RB_ABORTS).optional(),
    })
    .optional(),
});

export const WantedItemDeleted = GenericResponse.extend({ deleted: whole });

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(WantedItem, { market_price: 'marktpreis', currency: 'waehrung' });
v1Keys(WantedListResponse, { item: 'merkposten' });
v1Keys(WantedItemReply, { item: 'merkposten' });
v1Keys(WantedItemOwnerReply, { merged: 'zusammengefuehrt' });
v1Keys(WantedItemDeleted, { deleted: 'geloescht' });
v1Keys(WantedXmlResult, { error: 'fehler' });
v1Keys(WantedXmlResult.shape.items.element, { quantity: 'menge', condition: 'zustand', reason: 'grund' });

export const routes = {
  'GET /api/v2/wanted': {
    response: WantedListResponse,
    query: query({
      accounts: Q.accounts,
      search: Q.text(),
      condition: z.enum(['N', 'U', 'n', 'u', '']),
      sort: Q.text(40),
      ...PAGE,
    }),
  },
  'GET /api/v2/wanted/:setNumber/prices': { small: true, response: WantedItemPricesResponse },
  'POST /api/v2/wanted': {
    input: z.strictObject({
      set_number: TEXT(40),
      condition: CONDITION.nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
    }),
    response: WantedItemReply,
  },
  'PUT /api/v2/wanted/:setNumber/:condition/owner': {
    input: z.strictObject({ owner_user_id: IDENTIFIER.nullable().optional(), new_owner: IDENTIFIER }),
    response: WantedItemOwnerReply,
  },
  'DELETE /api/v2/wanted/:setNumber/:condition': {
    input: WITHOUT_BODY,
    response: WantedItemDeleted,
    query: query({ owner_user_id: Q.account }),
  },
  'POST /api/v2/wanted/:setNumber/:condition/take-over': {
    response: WantedItemTakeoverResponse,
    input: z.strictObject({
      quantity: input.pieceCount(),
      purchase_price: input.geld('Kaufpreis'),
      condition: CONDITION.nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
      storage: TEXT().nullable().optional(),
    }),
  },
  'POST /api/v2/wanted/import/csv': {
    form: true,
    response: CsvImportResult,
    input: z.strictObject({ owner_user_id: Q.account.optional() }),
  },
  'POST /api/v2/wanted-list/import/xml': {
    response: WantedXmlResult,
    form: true,
    input: z.strictObject({ corrections: z.string().max(5_000_000).optional() }),
    query: query({ write: Q.toggle, rebrickable: Q.toggle, stream: Q.toggle }),
  },
} satisfies Record<string, Route>;
