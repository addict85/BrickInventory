import { WITHOUT_BODY, TEXT, CONDITION, IDENTIFIER, query, Q, PAGE, PAGES_DETAIL, type Route } from './base';
import { z } from 'zod';
import { input } from '../infra/validate';
import {
  CsvImportResult,
  DEGRADED,
  ManuelleFigur,
  StueckGeaendert,
  MinifigsResponse,
  UsingSetsResponse,
  MovedToTrash,
} from './shared';

export { ManuelleFigur, StueckGeaendert };

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
  figs: z.array(ManuelleFigur),
  degradiert: DEGRADED,
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

export const routen = {
  'GET /api/v1/minifigs': {
    antwort: MinifigsResponse,
    abfrage: query({
      accounts: Q.konten,
      search: Q.text(),
      source: Q.text(20),
      set_number: Q.text(64),
      page: Q.zahl(),
      page_size: Q.zahl(),
    }),
  },
  'GET /api/v1/minifigs/:figNumber/sets': {
    klein: true,
    antwort: UsingSetsResponse,
    abfrage: query({ accounts: Q.konten }),
  },
  'GET /api/v1/minifigs/manual': {
    antwort: ManualFigsResponse,
    abfrage: query({ accounts: Q.konten, search: Q.text(), ...PAGE }),
  },
  'GET /api/v1/minifigs/stats': { antwort: MinifigStatsResponse, abfrage: query({ accounts: Q.konten }) },
  'POST /api/v1/minifigs': {
    antwort: AddMinifigResponse,
    eingabe: z.strictObject({
      fig_number: input.itemNumber('fig_number'),
      quantity: input.stueckzahl(),
      condition: input.zustand(),
      unit_price: input.geld('Stückpreis'),
      fig_name: input.text(200),
      image_url: input.imageUrl(),
      bl_fig_number: TEXT(64).nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
      storage: TEXT().nullable().optional(),
      acquired_at: TEXT(40).nullable().optional(),
    }),
  },
  'PUT /api/v1/minifigs/:figNumber': {
    abfrage: query({ owner: Q.konto }),
    eingabe: z.strictObject({
      quantity: input.quantityOrNothing(0, 100_000).optional(),
      quantity_delta: input.quantitiesDelta(),
      unit_price: input.geld('Stückpreis'),
      condition: CONDITION.nullable().optional(),
      bl_fig_number: TEXT(40).nullable().optional(),
    }),
    antwort: StueckGeaendert,
  },
  'DELETE /api/v1/minifigs/:figNumber': {
    eingabe: WITHOUT_BODY,
    antwort: MovedToTrash,
    abfrage: query({ owner: Q.konto }),
  },
  'POST /api/v1/minifigs/import/csv': { formular: true, antwort: CsvImportResult },
  'GET /api/v1/minifigs/:figNumber/parts': { klein: true, antwort: MinifigParts },
} satisfies Record<string, Route>;
