import { OHNE_RUMPF, ZUSTAND, KENNUNG, TEXT, abfrage, Q, SEITE, SEITEN_ANGABE } from './grund';
import { z } from 'zod';
import { eingabe } from '../infra/validate';
import type { Route } from './grund';
import { CsvImportErgebnis, DEGRADIERT, GenericResponse, PartValuationItem, PartsResponse, VerwendendeSetsResponse, InDenPapierkorb } from './gemeinsam';

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
  ...SEITEN_ANGABE,
  /** Die Liste führt keine Erfassungen; die Detailansicht lädt sie über /acquisitions. */
  parts: z.array(PartValuationItem.extend({ acquisitions: PartValuationItem.shape.acquisitions.optional() })),
  error: z.string().nullable().optional(),
  degradiert: DEGRADIERT,
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
  manual_parts: z.number().int().optional(),
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
export const BlFarbTabelle = z.looseObject({ success: z.literal(true), source: z.string(), map: z.record(z.string(), z.unknown()), degradiert: DEGRADIERT });

export const routen = {
  'GET /api/v1/parts': { antwort: PartsResponse, abfrage: abfrage({ accounts: Q.konten, search: Q.text(), color: Q.text(64),
    category: Q.text(), page: Q.zahl(), page_size: Q.zahl(), set_number: Q.text(64), exclude_manual: Q.schalter,
    spare: z.enum(['0', '1', '']), with_sets: Q.schalter, storage: Q.text(), ordnung: z.enum(['farbe', 'name', 'menge']) }) },
  'GET /api/v1/parts/:partNumber/:colorId/sets': { klein: true, antwort: VerwendendeSetsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/parts/stats': { antwort: PartsStatsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/parts/brick-colors': { klein: true, antwort: BrickColorsResponse },
  'GET /api/v1/parts/colors': { klein: true, antwort: PartsFilterColorsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/parts/categories': { klein: true, antwort: PartsCategoriesResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/parts/manual': { antwort: ManualPartsResponse, abfrage: abfrage({ accounts: Q.konten, search: Q.text(), storage: Q.text(), ...SEITE }) },
  'PUT /api/v1/parts/:partNumber/:colorId/color': { antwort: TeilFarbeResponse, abfrage: abfrage({ owner: Q.konto }),
    eingabe: z.strictObject({ color_id: KENNUNG.nullable().optional(), color_name: eingabe.text(100), color_hex: eingabe.farbcode() }) },
  'POST /api/v1/parts/owned': { antwort: BestandResponse, abfrage: abfrage({ accounts: Q.konten }), eingabe: z.strictObject({
    teile: z.array(z.looseObject({ part_number: z.union([z.string(), z.number()]).optional(), color_id: z.union([z.string(), z.number()]).nullable().optional() })).optional() }) },
  'POST /api/v1/parts': { antwort: AddPartResponse, eingabe: z.strictObject({
    part_number: eingabe.artikelnummer('part_number'), color_id: eingabe.farbe(), color_name: eingabe.text(100),
    color_hex: eingabe.farbcode(), quantity: eingabe.stueckzahl(), condition: eingabe.zustand(),
    unit_price: eingabe.geld('Stückpreis'), part_name: eingabe.text(200), image_url: eingabe.bildUrl(),
    category_name: eingabe.text(100), owner_user_id: KENNUNG.nullable().optional(), storage: TEXT().nullable().optional(), acquired_at: TEXT(40).nullable().optional() }) },
  'PUT /api/v1/parts/:partNumber/:colorId': { abfrage: abfrage({ owner: Q.konto }), eingabe: z.strictObject({ quantity: eingabe.mengeOderNichts(0, 100_000).optional(), quantity_delta: eingabe.mengenDelta(), unit_price: eingabe.geld('Stückpreis'), condition: ZUSTAND.nullable().optional() }), antwort: GenericResponse },
  'DELETE /api/v1/parts/:partNumber/:colorId': { eingabe: OHNE_RUMPF, antwort: InDenPapierkorb, abfrage: abfrage({ owner: Q.konto }) },
  'POST /api/v1/parts/import/csv': { formular: true, antwort: CsvImportErgebnis },
  'GET /api/v1/parts/bl-color-map': { klein: true, antwort: BlFarbTabelle },
} satisfies Record<string, Route>;
