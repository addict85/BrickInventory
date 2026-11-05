import { OHNE_RUMPF, TEXT, ZUSTAND, KENNUNG, abfrage, Q, SEITE, SEITEN_ANGABE } from './grund';
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
  ...SEITEN_ANGABE,
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
  'GET /api/v1/minifigs': { antwort: MinifigsResponse, abfrage: abfrage({ accounts: Q.konten, search: Q.text(), source: Q.text(20),
    set_number: Q.text(64), page: Q.zahl(), page_size: Q.zahl() }) },
  'GET /api/v1/minifigs/:figNumber/sets': { klein: true, antwort: VerwendendeSetsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/minifigs/manual': { antwort: ManualFigsResponse, abfrage: abfrage({ accounts: Q.konten, search: Q.text(), ...SEITE }) },
  'GET /api/v1/minifigs/stats': { antwort: MinifigStatsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'POST /api/v1/minifigs': { antwort: AddMinifigResponse, eingabe: z.strictObject({
    fig_number: eingabe.artikelnummer('fig_number'), quantity: eingabe.stueckzahl(), condition: eingabe.zustand(),
    unit_price: eingabe.geld('Stückpreis'), fig_name: eingabe.text(200), image_url: eingabe.bildUrl(),
    bl_fig_number: TEXT(64).nullable().optional(), owner_user_id: KENNUNG.nullable().optional(), storage: TEXT().nullable().optional(), acquired_at: TEXT(40).nullable().optional() }) },
  'PUT /api/v1/minifigs/:figNumber': { abfrage: abfrage({ owner: Q.konto }), eingabe: z.strictObject({ quantity: eingabe.mengeOderNichts(0, 100_000).optional(), quantity_delta: eingabe.mengenDelta(), unit_price: eingabe.geld('Stückpreis'), condition: ZUSTAND.nullable().optional(), bl_fig_number: TEXT(40).nullable().optional() }), antwort: GenericResponse },
  'DELETE /api/v1/minifigs/:figNumber': { eingabe: OHNE_RUMPF, antwort: InDenPapierkorb, abfrage: abfrage({ owner: Q.konto }) },
  'POST /api/v1/minifigs/import/csv': { formular: true, antwort: CsvImportErgebnis },
  'GET /api/v1/minifigs/:figNumber/parts': { klein: true, antwort: FigurTeile },
} satisfies Record<string, Route>;
