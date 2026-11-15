import { z } from 'zod';
import { KontoName, zeit, veraltet, PROZENT_TEXT } from './grund';

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

/** Eine Zeile im Bericht eines Imports; welche Felder sie trägt, hängt von der Quelle ab. */
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
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable(),
  created_at: zeit.nullable(),
  kaufpreis_original: z.number().optional(),
  kaufpreis_waehrung: z.string().optional(),
  price_estimated: z.boolean().optional(),
});

const STUECK = {
  id: z.number().int().nullable(),
  quantity: z.number().int(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  purchase_price: z.number().nullable(),
  avg_price: z.number().nullable(),
  condition: z.string().nullable(),
  conditions: z.array(z.string()),
  user_id: z.number().int().nullable(),
  /** Nur im Haushalt (besitzerAnhaengen); allein gibt es keine Besitzer zu nennen. */
  owners: z.array(KontoName).optional(),
};
const BEWERTET = {
  ausstehend: z.boolean(),
  from_cache: z.boolean(),
  max_price: z.number().nullable(),
  min_price: z.number().nullable(),
  qty_avg_price: veraltet(z.number().nullable(), 'avg_price'),
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable(),
  display_value: veraltet(z.string().nullable(), 'wert_gesamt'),
  total_value: veraltet(z.string(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable(),
  acquisitions: z.array(ValuationAcquisition),
};
/** Der Bestand (manuelle Listen): Zähler, Lagerort; die Käufe lädt das Detail über /acquisitions. */
const IM_BESTAND = {
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

export const FigValuationItem = z.looseObject({ ...STUECK, ...FIGUR, ...BEWERTET });
export const ManuelleFigur = z.looseObject({
  ...STUECK,
  ...FIGUR,
  ...IM_BESTAND,
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

/** Teile der Antwort, die nach einem Fehler nur Ersatzwerte tragen (src/infra/ergebnis.ts). */
export const DEGRADIERT = z.array(z.string()).optional();

/** Die schlichte Bestätigung; wer mehr sagt, erweitert sie (sonst wurde jedes Feld jeder Route überall freiwillig). */
export const GenericResponse = z.looseObject({ success: z.boolean() });

/** Eine geänderte oder gelöschte Erfassung. Welche Felder kommen, hängt vom Weg ab (anderes Konto,
 * Menge, Löschen; beim Set das Zustands-Aggregat), deshalb sind sie freiwillig. */
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
  /** Teile der Antwort, die nach einem Fehler nur Ersatzwerte tragen (etwa `kaufpreis`). */
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
  /** Nur im Haushalt (besitzerAnhaengen); allein gibt es keine Besitzer zu nennen. */
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

/** Eine Figur aus dem Inhalt eines Sets (figurenlisteDesSets): dieselbe Form ohne Bestand. */
export const SetFigur = z.looseObject({
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

/** `source` nennt die Herkunft der Liste; `error`, warum die Quelle gestört war. */
export const SetFigurenResponse = z.looseObject({
  success: z.boolean(),
  source: z.string(),
  figs: z.array(SetFigur),
  error: z.string().optional(),
});

const TEIL_IN_LISTE = {
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
  ...TEIL_IN_LISTE,
  /** Fehlen nur im Rückfall auf Rebrickable (Teile eines Sets, das niemand erfasst hat). */
  condition: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),
  category_name: z.string().nullable(),
  image_local: z.string().nullable(),
  /** Nur mit Setfilter: die Sets, aus denen das Teil stammt. */
  in_sets: z.string().nullable().optional(),
});

export const SetTeil = z.looseObject({ ...TEIL_IN_LISTE, bl_color_id: z.number().int().nullable() });

export const PartValuationItem = z.looseObject({ ...STUECK, ...TEIL, ...BEWERTET });
export const ManuellesTeil = z.looseObject({
  ...STUECK,
  ...TEIL,
  ...IM_BESTAND,
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
  degradiert: DEGRADIERT,
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

/** Löschen legt in den Papierkorb; die Kennungen holen es zurück. */
export const InDenPapierkorb = GenericResponse.extend({ papierkorb: z.array(z.number().int()) });
