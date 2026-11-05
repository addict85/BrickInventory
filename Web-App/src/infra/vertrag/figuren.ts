import { OHNE_RUMPF, ZAHL, TEXT, ZUSTAND } from './grund';
import { z } from 'zod';
import { eingabe } from '../validate';
import type { Route } from './grund';
import { CsvImportErgebnis, FigValuationItem, GenericResponse, MinifigsResponse, VerwendendeSetsResponse, InDenPapierkorb } from './gemeinsam';

export const AddMinifigResponse = z.looseObject({
  success: z.boolean(),
  action: z.string().nullable().optional(),
  fig_number: z.string().nullable().optional(),
  fig_name: z.string().nullable().optional(),
  price_from_condition: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const ManualFigsResponse = z.looseObject({
  success: z.boolean(),
  /** Die Liste führt keine Erfassungen; die Detailansicht lädt sie über /acquisitions. */
  figs: z.array(FigValuationItem.extend({ acquisitions: FigValuationItem.shape.acquisitions.optional() })),
  error: z.string().nullable().optional(),
});

export const MinifigStats = z.looseObject({
  types: z.number().int(),
  total_quantity: z.number().int(),
  manual: z.number().int(),
});

export const MinifigStatsResponse = z.looseObject({
  success: z.boolean(),
  stats: MinifigStats,
});

/** Teile einer Figur aus dem Rebrickable-Katalog; `source` sagt, woher. */
export const FigurTeile = z.looseObject({ success: z.literal(true), source: z.string(), parts: z.array(z.record(z.string(), z.unknown())) });

export const routen = {
  'GET /api/v1/minifigs': { antwort: MinifigsResponse },
  'GET /api/v1/minifigs/:figNumber/sets': { antwort: VerwendendeSetsResponse },
  'GET /api/v1/minifigs/manual': { antwort: ManualFigsResponse },
  'GET /api/v1/minifigs/stats': { antwort: MinifigStatsResponse },
  'POST /api/v1/minifigs': { antwort: AddMinifigResponse, eingabe: z.looseObject({
    fig_number: eingabe.artikelnummer('fig_number'), quantity: eingabe.stueckzahl(), condition: eingabe.zustand(),
    unit_price: eingabe.preis('Stückpreis'), fig_name: eingabe.text(200), image_url: eingabe.bildUrl() }) },
  'PUT /api/v1/minifigs/:figNumber': { eingabe: z.looseObject({ quantity: ZAHL.optional(), quantity_delta: ZAHL.nullable().optional(), unit_price: ZAHL.nullable().optional(), condition: ZUSTAND.nullable().optional(), bl_fig_number: TEXT(40).nullable().optional() }), antwort: GenericResponse },
  'DELETE /api/v1/minifigs/:figNumber': { eingabe: OHNE_RUMPF, antwort: InDenPapierkorb },
  'POST /api/v1/minifigs/import/csv': { formular: true, antwort: CsvImportErgebnis },
  'GET /api/v1/minifigs/:figNumber/parts': { antwort: FigurTeile },
} satisfies Record<string, Route>;
