import { WITHOUT_BODY, ZUSTAND, KENNUNG, TEXT, abfrage, Q, SEITE, PAGES_DETAIL, type Route } from './base';
import { z } from 'zod';
import { eingabe } from '../infra/validate';
import {
  CsvImportErgebnis,
  DEGRADED,
  StueckGeaendert,
  ManuellesTeil,
  PartsResponse,
  VerwendendeSetsResponse,
  InDenTrash,
} from './shared';

export { ManuellesTeil, StueckGeaendert };

export const AddPartResponse = z.looseObject({
  success: z.boolean(),
  action: z.string(),
  part_number: z.string(),
  part_name: z.string().nullable().optional(),
  price_from_condition: z.string().nullable().optional(),
});

export const BestandEintrag = z.looseObject({
  gesamt: z.number().int(),
  lose: z.number().int(),
});

export const BestandResponse = z.looseObject({
  success: z.boolean(),
  bestand: z.record(z.string(), BestandEintrag),
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
  parts: z.array(ManuellesTeil),
  degradiert: DEGRADED,
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

export const TeilFarbeResponse = z.looseObject({
  bild: z.string().nullable(),
  success: z.boolean(),
  zusammengelegt: z.boolean(),
  verschoben: z.number().int(),
  vereint: z.number().int(),
});

/** BrickLink color → Rebrickable color; `source` says where the table comes from. */
export const BlFarbTabelle = z.looseObject({
  success: z.literal(true),
  source: z.string(),
  map: z.record(z.string(), z.unknown()),
  degradiert: DEGRADED,
});

export const routen = {
  'GET /api/v1/parts': {
    antwort: PartsResponse,
    abfrage: abfrage({
      accounts: Q.konten,
      search: Q.text(),
      color: Q.text(64),
      category: Q.text(),
      page: Q.zahl(),
      page_size: Q.zahl(),
      set_number: Q.text(64),
      exclude_manual: Q.schalter,
      spare: z.enum(['0', '1', '']),
      with_sets: Q.schalter,
      storage: Q.text(),
      ordnung: z.enum(['farbe', 'name', 'menge']),
    }),
  },
  'GET /api/v1/parts/:partNumber/:colorId/sets': {
    klein: true,
    antwort: VerwendendeSetsResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/parts/stats': { antwort: PartsStatsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/parts/brick-colors': { klein: true, antwort: BrickColorsResponse },
  'GET /api/v1/parts/colors': {
    klein: true,
    antwort: PartsFilterColorsResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/parts/categories': {
    klein: true,
    antwort: PartsCategoriesResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/parts/manual': {
    antwort: ManualPartsResponse,
    abfrage: abfrage({ accounts: Q.konten, search: Q.text(), storage: Q.text(), ...SEITE }),
  },
  'PUT /api/v1/parts/:partNumber/:colorId/color': {
    antwort: TeilFarbeResponse,
    abfrage: abfrage({ owner: Q.konto }),
    eingabe: z.strictObject({
      color_id: KENNUNG.nullable().optional(),
      color_name: eingabe.text(100),
      color_hex: eingabe.farbcode(),
    }),
  },
  'POST /api/v1/parts/owned': {
    antwort: BestandResponse,
    abfrage: abfrage({ accounts: Q.konten }),
    eingabe: z.strictObject({
      teile: z
        .array(
          z.looseObject({
            part_number: z.union([z.string(), z.number()]).optional(),
            color_id: z.union([z.string(), z.number()]).nullable().optional(),
          }),
        )
        .optional(),
    }),
  },
  'POST /api/v1/parts': {
    antwort: AddPartResponse,
    eingabe: z.strictObject({
      part_number: eingabe.itemNumber('part_number'),
      color_id: eingabe.farbe(),
      color_name: eingabe.text(100),
      color_hex: eingabe.farbcode(),
      quantity: eingabe.stueckzahl(),
      condition: eingabe.zustand(),
      unit_price: eingabe.geld('Stückpreis'),
      part_name: eingabe.text(200),
      image_url: eingabe.imageUrl(),
      category_name: eingabe.text(100),
      owner_user_id: KENNUNG.nullable().optional(),
      storage: TEXT().nullable().optional(),
      acquired_at: TEXT(40).nullable().optional(),
    }),
  },
  'PUT /api/v1/parts/:partNumber/:colorId': {
    abfrage: abfrage({ owner: Q.konto }),
    eingabe: z.strictObject({
      quantity: eingabe.quantityOrNothing(0, 100_000).optional(),
      quantity_delta: eingabe.quantitiesDelta(),
      unit_price: eingabe.geld('Stückpreis'),
      condition: ZUSTAND.nullable().optional(),
    }),
    antwort: StueckGeaendert,
  },
  'DELETE /api/v1/parts/:partNumber/:colorId': {
    eingabe: WITHOUT_BODY,
    antwort: InDenTrash,
    abfrage: abfrage({ owner: Q.konto }),
  },
  'POST /api/v1/parts/import/csv': { formular: true, antwort: CsvImportErgebnis },
  'GET /api/v1/parts/bl-color-map': { klein: true, antwort: BlFarbTabelle },
} satisfies Record<string, Route>;
