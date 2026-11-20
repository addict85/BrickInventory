import { z } from 'zod';
import { KontoName, zeit, veraltet, PERCENT_TEXT } from './base';

export const BestandteilKopf = z.looseObject({
  nummer: z.string(),
  name: z.string().nullable().optional(),
  color_id: z.number().int().nullable().optional(),
  color_name: z.string().nullable().optional(),
  color_hex: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  is_spare: z.boolean(),
  storage: z.string().nullable().optional(),
  owner_ids: z.array(z.number().int()),
  total_quantity: z.number().int(),
});

export const BrickLinkRef = z.looseObject({
  type: z.string(),
  number: z.string(),
  url: z.string().nullable().optional(),
  exact: z.boolean(),
  resolved: z.boolean(),
});

/** A row in an import's report; which fields it carries depends on the source. */
export const ImportZeile = z.looseObject({
  set_number: z.string().optional(),
  zeile: z.number().int().optional(),
  success: z.boolean().optional(),
  action: z.string().optional(),
  isWarning: z.boolean().optional(),
  error: z.string().nullable().optional(),
  code: z.string().optional(),
  menge: z.number().int().optional(),
  katalog_offen: z.boolean().optional(),
  part_number: z.string().optional(),
  fig_number: z.string().optional(),
  fig_name: z.string().nullable().optional(),
  condition: z.string().optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  waehrung_angepasst: z.boolean().optional(),
  waehrung_datei: z.string().optional(),
  waehrung_konto: z.string().optional(),
});

export const CsvImportErgebnis = z.looseObject({
  success: z.boolean(),
  total: z.number().int(),
  added: z.number().int(),
  updated: z.number().int(),
  errors: z.number().int(),
  results: z.array(ImportZeile),
  skipped: z.number().int().optional(),
  skipped_hint: z.string().optional(),
  waehrung_hinweis: z.string().nullable().optional(),
});

export const ValuationAcquisition = z.looseObject({
  id: z.number().int(),
  condition: z.string(),
  quantity: z.number().int(),
  purchase_price: z.number().nullable(),
  avg_price: z.number().nullable(),
  total_avg: z.string().nullable(),
  wert_gesamt: z.number().nullable(),
  pnl_pct: PERCENT_TEXT,
  pnl_prozent: z.number().nullable(),
  created_at: zeit.nullable(),
  kaufpreis_original: z.number().optional(),
  kaufpreis_waehrung: z.string().optional(),
  price_estimated: z.boolean().optional(),
});

const PIECE = {
  id: z.number().int().nullable(),
  quantity: z.number().int(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  purchase_price: z.number().nullable(),
  avg_price: z.number().nullable(),
  condition: z.string().nullable(),
  conditions: z.array(z.string()),
  user_id: z.number().int().nullable(),
  /** Only in the household (besitzerAnhaengen); alone there are no owners to name. */
  owners: z.array(KontoName).optional(),
};
const VALUED = {
  /** The price details are missing without an acquisition (no condition to value); ausstehend only while one is missing. */
  ausstehend: z.boolean().optional(),
  from_cache: z.boolean().optional(),
  max_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  qty_avg_price: veraltet(z.number().nullable(), 'avg_price'),
  pnl_pct: PERCENT_TEXT,
  pnl_prozent: z.number().nullable(),
  display_value: veraltet(z.string().nullable(), 'wert_gesamt'),
  total_value: veraltet(z.string(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable(),
  acquisitions: z.array(ValuationAcquisition),
};
/** The inventory (manual lists): counters, storage location; the detail loads the purchases via /acquisitions. */
const IN_INVENTORY = {
  acq_count: z.number().int().nullable(),
  used_count: z.number().int().nullable(),
  avg_purchase_price: z.number().nullable(),
  storage: z.string().nullable(),
};
const FIGUR = {
  fig_number: z.string(),
  bl_fig_number: z.string().nullable(),
  fig_name: z.string().nullable(),
  set_number: z.string().nullable(),
  source: z.string().nullable(),
  storage_id: z.number().int().nullable(),
};
const TEIL = {
  part_number: z.string(),
  bl_part_number: z.string().nullable(),
  part_name: z.string().nullable(),
  color_id: z.number().int(),
  color_name: z.string().nullable(),
  color_hex: z.string().nullable(),
  unit_price: z.number().nullable(),
};

export const FigValuationItem = z.looseObject({ ...PIECE, ...FIGUR, ...VALUED });
export const ManuelleFigur = z.looseObject({
  ...PIECE,
  ...FIGUR,
  ...IN_INVENTORY,
  unit_price: z.number().nullable(),
});

export const GenericAdminResponse = z.looseObject({ success: z.boolean() });

export const SetAggregate = z.looseObject({
  set_number: z.string(),
  condition: z.string(),
  acq_count: z.number().int(),
  used_count: z.number().int(),
  conditions: z.array(z.string()),
  max_purchase_price: z.number().nullable(),
  avg_purchase_price: z.number().nullable(),
});

/** Parts of the response that carry only substitute values after an error (src/infra/result.ts). */
export const DEGRADED = z.array(z.string()).optional();

/** The plain confirmation; whoever says more extends it (otherwise every field of every route became optional everywhere). */
export const GenericResponse = z.looseObject({ success: z.boolean() });

/** A changed or deleted acquisition. Which fields come depends on the path (other account,
 * quantity, deletion; for the set the condition aggregate), hence they are optional. */
export const Erfassungsantwort = GenericResponse.extend({
  new_quantity: z.number().int().optional(),
  from_user_id: z.number().int().optional(),
  to_user_id: z.number().int().optional(),
  merged: z.boolean().optional(),
  unchanged: z.boolean().optional(),
  acquisitions: z.number().int().optional(),
  instructions: z.number().int().optional(),
  set: SetAggregate.nullable().optional(),
  parts: z.number().int().optional(),
  minifigs: z.number().int().optional(),
  source_emptied: z.boolean().optional(),
  quantity: z.number().int().nullable().optional(),
  /** Parts of the response that carry only substitute values after an error (e.g. `kaufpreis`). */
  degradiert: z.array(z.string()).optional(),
});

export const StueckGeaendert = GenericResponse.extend({ quantity: z.number().int().optional() });

export const Minifig = z.looseObject({
  id: z.number().int().nullable(),
  in_sets: z.string().nullable(),
  set_number: z.string().nullable(),
  storage: z.string().nullable(),
  unit_price: z.number().nullable(),
  fig_number: z.string(),
  condition: z.string().nullable(),
  conditions: z.array(z.string()),
  /** Only in the household (besitzerAnhaengen); alone there are no owners to name. */
  owners: z.array(KontoName).optional(),
  owner_ids: z.array(z.number().int()).optional(),
  avg_purchase_price: z.number().nullable().optional(),
  fig_name: z.string().nullable(),
  quantity: z.number().int(),
  total_quantity: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  source: z.string(),
  set_added_at: zeit.nullable(),
});

/** A figure from a set's contents (minifigsListOfSets): the same shape without inventory. */
export const SetMinifig = z.looseObject({
  fig_number: z.string(),
  fig_name: z.string(),
  quantity: z.number().int(),
  total_quantity: z.number().int(),
  image_url: z.string().nullable(),
  source: z.string(),
  conditions: z.array(z.string()),
  owners: z.array(KontoName),
});

export const MinifigsResponse = z.looseObject({
  success: z.boolean(),
  total: z.number().int(),
  figs: z.array(Minifig),
});

/** `source` names the origin of the list; `error` why the source was disrupted. */
export const SetFigurenResponse = z.looseObject({
  success: z.boolean(),
  source: z.string(),
  figs: z.array(SetMinifig),
  error: z.string().optional(),
});

const PART_IN_LIST = {
  part_number: z.string(),
  bl_part_number: z.string().nullable(),
  part_name: z.string().nullable(),
  color_id: z.number().int(),
  color_name: z.string().nullable(),
  color_hex: z.string().nullable(),
  image_url: z.string().nullable(),
  total_quantity: z.number().int(),
  is_spare: z.boolean(),
};

export const Part = z.looseObject({
  ...PART_IN_LIST,
  /** Missing only in the fallback to Rebrickable (parts of a set nobody captured). */
  condition: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),
  category_name: z.string().nullable(),
  image_local: z.string().nullable(),
  /** Only with a set filter: the sets the part comes from. */
  in_sets: z.string().nullable().optional(),
});

export const SetTeil = z.looseObject({ ...PART_IN_LIST, bl_color_id: z.number().int().nullable() });

export const PartValuationItem = z.looseObject({ ...PIECE, ...TEIL, ...VALUED });
export const ManuellesTeil = z.looseObject({
  ...PIECE,
  ...TEIL,
  ...IN_INVENTORY,
  category_name: z.string().nullable(),
  created_at: zeit.nullable(),
  source: z.string().nullable(),
});

export const PartsResponse = z.looseObject({
  source: z.string().nullable(),
  success: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  parts: z.array(Part),
  degradiert: DEGRADED,
});

export const SetTeileResponse = z.looseObject({
  source: z.string().nullable(),
  success: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  parts: z.array(SetTeil),
  error: z.string().optional(),
});

export const VerwendendesSet = z.looseObject({
  set_number: z.string(),
  set_name: z.string().nullable().optional(),
  quantity: z.number().int(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  owner_user_id: z.number().int(),
});

export const VerwendendeSetsResponse = z.looseObject({
  success: z.boolean(),
  item: BestandteilKopf.nullable().optional(),
  sets: z.array(VerwendendesSet),
});

/** Deleting moves into the trash; the identifiers bring it back. */
export const InDenTrash = GenericResponse.extend({ papierkorb: z.array(z.number().int()) });
