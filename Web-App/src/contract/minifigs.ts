import { WITHOUT_BODY, TEXT, CONDITION, IDENTIFIER, query, Q, PAGE, PAGES_DETAIL, type Route } from './base';
import { z } from 'zod';
import { input } from '../infra/validate';
import {
  CsvImportResult,
  DEGRADED,
  ManualMinifig,
  PieceChanged,
  MinifigsResponse,
  UsingSetsResponse,
  MovedToTrash,
} from './shared';

export { ManualMinifig, PieceChanged };

export const AddMinifigResponse = z.looseObject({
  success: z.boolean(),
  action: z.string(),
  fig_number: z.string(),
  fig_name: z.string().nullable().optional(),
  price_from_condition: z.string().nullable().optional(),
});

export const ManualFigsResponse = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  /** The list carries no acquisitions; the detail view loads them via /acquisitions. */
  figs: z.array(ManualMinifig),
  degraded: DEGRADED,
});

export const MinifigStats = z.looseObject({
  unique_figs: z.number().int(),
  types: z.number().int(),
  total_quantity: z.number().int(),
  manual: z.number().int(),
});

export const MinifigStatsResponse = z.looseObject({
  success: z.boolean(),
  stats: MinifigStats,
});

/** A figure's parts from the Rebrickable catalog; `source` says from where. */
export const MinifigParts = z.looseObject({
  success: z.literal(true),
  source: z.string(),
  parts: z.array(z.record(z.string(), z.unknown())),
});

export const routes = {
  'GET /api/v2/minifigs': {
    response: MinifigsResponse,
    query: query({
      accounts: Q.accounts,
      search: Q.text(),
      source: Q.text(20),
      set_number: Q.text(64),
      page: Q.number(),
      page_size: Q.number(),
    }),
  },
  'GET /api/v2/minifigs/:figNumber/sets': {
    small: true,
    response: UsingSetsResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/minifigs/manual': {
    response: ManualFigsResponse,
    query: query({ accounts: Q.accounts, search: Q.text(), ...PAGE }),
  },
  'GET /api/v2/minifigs/stats': { response: MinifigStatsResponse, query: query({ accounts: Q.accounts }) },
  'POST /api/v2/minifigs': {
    response: AddMinifigResponse,
    input: z.strictObject({
      fig_number: input.itemNumber('fig_number'),
      quantity: input.pieceCount(),
      condition: input.condition(),
      unit_price: input.geld('Stückpreis'),
      fig_name: input.text(200),
      image_url: input.imageUrl(),
      bl_fig_number: TEXT(64).nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
      storage: TEXT().nullable().optional(),
      acquired_at: TEXT(40).nullable().optional(),
    }),
  },
  'PUT /api/v2/minifigs/:figNumber': {
    query: query({ owner: Q.account }),
    input: z.strictObject({
      quantity: input.quantityOrNothing(0, 100_000).optional(),
      quantity_delta: input.quantitiesDelta(),
      unit_price: input.geld('Stückpreis'),
      condition: CONDITION.nullable().optional(),
      bl_fig_number: TEXT(40).nullable().optional(),
    }),
    response: PieceChanged,
  },
  'DELETE /api/v2/minifigs/:figNumber': {
    input: WITHOUT_BODY,
    response: MovedToTrash,
    query: query({ owner: Q.account }),
  },
  'POST /api/v2/minifigs/import/csv': { form: true, response: CsvImportResult },
  'GET /api/v2/minifigs/:figNumber/parts': { small: true, response: MinifigParts },
} satisfies Record<string, Route>;
