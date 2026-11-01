import { z } from 'zod';
import { eingabe } from '../validate';
import type { Route } from './grund';
import { CsvImportErgebnis, GenericResponse, PartValuationItem, PartsResponse, VerwendendeSetsResponse, InDenPapierkorb } from './gemeinsam';

export const AddPartResponse = z.looseObject({
  success: z.boolean(),
  action: z.string().nullable().optional(),
  part_number: z.string().nullable().optional(),
  part_name: z.string().nullable().optional(),
  price_from_condition: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const BestandEintrag = z.looseObject({
  gesamt: z.number().int().optional(),
  lose: z.number().int().optional(),
});

export const BestandResponse = z.looseObject({
  success: z.boolean().optional(),
  bestand: z.record(z.string(), BestandEintrag).optional(),
  error: z.string().nullable().optional(),
});

export const BrickColor = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  hex: z.string().nullable().optional(),
});

export const BrickColorsResponse = z.looseObject({
  success: z.boolean(),
  colors: z.array(BrickColor),
  error: z.string().nullable().optional(),
});

export const ManualPartsResponse = z.looseObject({
  success: z.boolean(),
  /** Die Liste führt keine Erfassungen; die Detailansicht lädt sie über /acquisitions. */
  parts: z.array(PartValuationItem.extend({ acquisitions: PartValuationItem.shape.acquisitions.optional() })),
  error: z.string().nullable().optional(),
});

export const PartsCategory = z.looseObject({
  category_name: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  unique_parts: z.number().int(),
  total_quantity: z.number().int(),
});

export const PartsCategoriesResponse = z.looseObject({
  success: z.boolean(),
  categories: z.array(PartsCategory),
});

export const PartsFilterColor = z.looseObject({
  color_name: z.string().nullable().optional(),
  color_hex: z.string().nullable().optional(),
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
});

export const PartsStatsResponse = z.looseObject({
  success: z.boolean(),
  stats: PartsStats.nullable().optional(),
});

export const TeilFarbeResponse = z.looseObject({
  success: z.boolean().optional(),
  zusammengelegt: z.boolean().optional(),
  verschoben: z.number().int().optional(),
  vereint: z.number().int().optional(),
  error: z.string().nullable().optional(),
});

/** BrickLink-Farbe → Rebrickable-Farbe; `source` sagt, woher die Tabelle stammt. */
export const BlFarbTabelle = z.looseObject({ success: z.literal(true), source: z.string(), map: z.record(z.string(), z.unknown()) });

export const routen = {
  'GET /api/v1/parts': { antwort: PartsResponse },
  'GET /api/v1/parts/:partNumber/:colorId/sets': { antwort: VerwendendeSetsResponse },
  'GET /api/v1/parts/stats': { antwort: PartsStatsResponse },
  'GET /api/v1/parts/brick-colors': { antwort: BrickColorsResponse },
  'GET /api/v1/parts/colors': { antwort: PartsFilterColorsResponse },
  'GET /api/v1/parts/categories': { antwort: PartsCategoriesResponse },
  'GET /api/v1/parts/manual': { antwort: ManualPartsResponse },
  'PUT /api/v1/parts/:partNumber/:colorId/color': { antwort: TeilFarbeResponse, eingabe: z.looseObject({ color_name: eingabe.text(100), color_hex: eingabe.farbcode() }) },
  'POST /api/v1/parts/owned': { antwort: BestandResponse },
  'POST /api/v1/parts': { antwort: AddPartResponse, eingabe: z.looseObject({
    part_number: eingabe.artikelnummer('part_number'), color_id: eingabe.farbe(), color_name: eingabe.text(100),
    color_hex: eingabe.farbcode(), quantity: eingabe.stueckzahl(), condition: eingabe.zustand(),
    unit_price: eingabe.preis('Stückpreis'), part_name: eingabe.text(200), image_url: eingabe.bildUrl(),
    category_name: eingabe.text(100) }) },
  'PUT /api/v1/parts/:partNumber/:colorId': { antwort: GenericResponse },
  'DELETE /api/v1/parts/:partNumber/:colorId': { antwort: InDenPapierkorb },
  'POST /api/v1/parts/import/csv': { antwort: CsvImportErgebnis },
  'GET /api/v1/parts/bl-color-map': { antwort: BlFarbTabelle },
} satisfies Record<string, Route>;
