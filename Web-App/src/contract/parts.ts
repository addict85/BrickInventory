import { WITHOUT_BODY, CONDITION, IDENTIFIER, TEXT, query, Q, PAGE, PAGES_DETAIL, type Route } from './base';
import { z } from 'zod';
import { v1Keys } from './v1';
import { input } from '../infra/validate';
import {
  CsvImportResult,
  DEGRADED,
  PieceChanged,
  ManualPart,
  PartsResponse,
  UsingSetsResponse,
  MovedToTrash,
} from './shared';

export { ManualPart, PieceChanged };

export const AddPartResponse = z.looseObject({
  success: z.boolean(),
  action: z.string(),
  part_number: z.string(),
  part_name: z.string().nullable().optional(),
  price_from_condition: z.string().nullable().optional(),
});

export const HoldingEntry = z.looseObject({
  total: z.number().int(),
  loose: z.number().int(),
});

export const HoldingResponse = z.looseObject({
  success: z.boolean(),
  holding: z.record(z.string(), HoldingEntry),
});

export const BrickColor = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  hex: z.string().nullable(),
});

export const BrickColorsResponse = z.looseObject({
  success: z.boolean(),
  colors: z.array(BrickColor),
});

export const ManualPartsResponse = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  /** The list carries no acquisitions; the detail view loads them via /acquisitions. */
  parts: z.array(ManualPart),
  degraded: DEGRADED,
});

export const PartsCategory = z.looseObject({
  category_name: z.string().nullable(),
  label: z.string().nullable(),
  unique_parts: z.number().int(),
  total_quantity: z.number().int(),
});

export const PartsCategoriesResponse = z.looseObject({
  success: z.boolean(),
  categories: z.array(PartsCategory),
});

export const PartsFilterColor = z.looseObject({
  color_name: z.string().nullable(),
  color_hex: z.string().nullable(),
  unique_parts: z.number().int(),
  total_quantity: z.number().int(),
});

export const PartsFilterColorsResponse = z.looseObject({
  success: z.boolean(),
  colors: z.array(PartsFilterColor),
});

export const PartsStats = z.looseObject({
  unique_parts: z.number().int(),
  unique_colors: z.number().int(),
  total_parts: z.number().int(),
  manual_parts: z.number().int().optional(),
});

export const PartsStatsResponse = z.looseObject({
  success: z.boolean(),
  stats: PartsStats.nullable(),
});

export const PartColorResponse = z.looseObject({
  image: z.string().nullable(),
  success: z.boolean(),
  combined: z.boolean(),
  moved: z.number().int(),
  united: z.number().int(),
});

/** BrickLink color → Rebrickable color; `source` says where the table comes from. */
export const BlColorTable = z.looseObject({
  success: z.literal(true),
  source: z.string(),
  map: z.record(z.string(), z.unknown()),
  degraded: DEGRADED,
});

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(HoldingEntry, { total: 'gesamt' });

export const routes = {
  'GET /api/v2/parts': {
    response: PartsResponse,
    query: query({
      accounts: Q.accounts,
      search: Q.text(),
      color: Q.text(64),
      category: Q.text(),
      page: Q.number(),
      page_size: Q.number(),
      set_number: Q.text(64),
      exclude_manual: Q.toggle,
      spare: z.enum(['0', '1', '']),
      with_sets: Q.toggle,
      storage: Q.text(),
      order: z.enum(['farbe', 'name', 'menge']),
    }),
  },
  'GET /api/v2/parts/:partNumber/:colorId/sets': {
    small: true,
    response: UsingSetsResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/parts/stats': { response: PartsStatsResponse, query: query({ accounts: Q.accounts }) },
  'GET /api/v2/parts/brick-colors': { small: true, response: BrickColorsResponse },
  'GET /api/v2/parts/colors': {
    small: true,
    response: PartsFilterColorsResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/parts/categories': {
    small: true,
    response: PartsCategoriesResponse,
    query: query({ accounts: Q.accounts }),
  },
  'GET /api/v2/parts/manual': {
    response: ManualPartsResponse,
    query: query({ accounts: Q.accounts, search: Q.text(), storage: Q.text(), ...PAGE }),
  },
  'PUT /api/v2/parts/:partNumber/:colorId/color': {
    response: PartColorResponse,
    query: query({ owner: Q.account }),
    input: z.strictObject({
      color_id: IDENTIFIER.nullable().optional(),
      color_name: input.text(100),
      color_hex: input.colorCode(),
    }),
  },
  'POST /api/v2/parts/owned': {
    response: HoldingResponse,
    query: query({ accounts: Q.accounts }),
    input: v1Keys(
      z.strictObject({
        parts: z
          .array(
            z.looseObject({
              part_number: z.union([z.string(), z.number()]).optional(),
              color_id: z.union([z.string(), z.number()]).nullable().optional(),
            }),
          )
          .optional(),
      }),
      { parts: 'teile' },
    ),
  },
  'POST /api/v2/parts': {
    response: AddPartResponse,
    input: z.strictObject({
      part_number: input.itemNumber('part_number'),
      color_id: input.color(),
      color_name: input.text(100),
      color_hex: input.colorCode(),
      quantity: input.pieceCount(),
      condition: input.condition(),
      unit_price: input.geld('Stückpreis'),
      part_name: input.text(200),
      image_url: input.imageUrl(),
      category_name: input.text(100),
      owner_user_id: IDENTIFIER.nullable().optional(),
      storage: TEXT().nullable().optional(),
      acquired_at: TEXT(40).nullable().optional(),
    }),
  },
  'PUT /api/v2/parts/:partNumber/:colorId': {
    query: query({ owner: Q.account }),
    input: z.strictObject({
      quantity: input.quantityOrNothing(0, 100_000).optional(),
      quantity_delta: input.quantitiesDelta(),
      unit_price: input.geld('Stückpreis'),
      condition: CONDITION.nullable().optional(),
    }),
    response: PieceChanged,
  },
  'DELETE /api/v2/parts/:partNumber/:colorId': {
    input: WITHOUT_BODY,
    response: MovedToTrash,
    query: query({ owner: Q.account }),
  },
  'POST /api/v2/parts/import/csv': { form: true, response: CsvImportResult },
  'GET /api/v2/parts/bl-color-map': { small: true, response: BlColorTable },
} satisfies Record<string, Route>;
