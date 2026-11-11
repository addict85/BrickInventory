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
  results: z.array(ImportZeile).optional(),
  waehrung_hinweis: z.string().nullable().optional(),
  success: z.boolean(),
  skipped: z.number().int().optional(),
  skipped_hint: z.string().optional(),
  total: z.number().int().optional(),
  added: z.number().int().optional(),
  imported: z.number().int().optional(),
  updated: z.number().int().optional(),
  errors: z.number().int().optional(),
  error: z.string().nullable().optional(),
  /** Nur beim Set-CSV: ob der Import lief (ohne `pruefen`) und wie viele Sets das Konto schon hat. */
  gestartet: z.boolean().optional(),
  vorhanden: z.number().int().optional(),
  vorhanden_nummern: z.array(z.string()).optional(),
});

export const ValuationAcquisition = z.looseObject({
  id: z.number().int(),
  condition: z.string(),
  quantity: z.number().int(),
  purchase_price: z.number().nullable().optional(),
  avg_price: z.number().nullable().optional(),
  total_avg: z.string().nullable().optional(),
  wert_gesamt: z.number().nullable().optional(),
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable().optional(),
  created_at: zeit.nullable().optional(),
  owner_user_id: z.number().int().nullable().optional(),
  kaufpreis_original: z.number().optional(),
  kaufpreis_waehrung: z.string().optional(),
  price_estimated: z.boolean().optional(),
});

export const FigValuationItem = z.looseObject({
  ausstehend: z.boolean().optional(),
  from_cache: z.boolean().optional(),
  max_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  set_number: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  storage_id: z.number().int().nullable().optional(),
  acq_count: z.number().int().nullable().optional(),
  used_count: z.number().int().nullable().optional(),
  id: z.number().int().nullable().optional(),
  fig_number: z.string(),
  bl_fig_number: z.string().nullable().optional(),
  fig_name: z.string().nullable().optional(),
  quantity: z.number().int(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  avg_purchase_price: z.number().nullable().optional(),
  qty_avg_price: veraltet(z.number().nullable().optional(), 'avg_price'),
  avg_price: z.number().nullable().optional(),
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable().optional(),
  display_value: veraltet(z.string().nullable().optional(), 'wert_gesamt'),
  total_value: veraltet(z.string().optional(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  conditions: z.array(z.string()),
  user_id: z.number().int().nullable().optional(),
  /** Nur im Haushalt (besitzerAnhaengen); allein gibt es keine Besitzer zu nennen. */
  owners: z.array(KontoName).optional(),
  acquisitions: z.array(ValuationAcquisition),
  storage: z.string().nullable().optional(),
});

export const GenericAdminResponse = z.looseObject({
  dauer_minuten: z.number().int().nullable().optional(),
  pending: z.number().int().nullable().optional(),
  queued: z.number().int().nullable().optional(),
  skipped: z.number().int().nullable().optional(),
  verworfen: z.number().int().nullable().optional(),
  success: z.boolean(),
  error: z.string().nullable().optional(),
  enqueued: z.number().int().optional(),
});

export const SetAggregate = z.looseObject({
  set_number: z.string().optional(),
  condition: z.string().nullable().optional(),
  acq_count: z.number().int().nullable().optional(),
  used_count: z.number().int().nullable().optional(),
  conditions: z.array(z.string()).optional(),
  max_purchase_price: z.number().nullable().optional(),
  avg_purchase_price: z.number().nullable().optional(),
});

/** Teile der Antwort, die nach einem Fehler nur Ersatzwerte tragen (src/infra/ergebnis.ts). */
export const DEGRADIERT = z.array(z.string()).optional();

export const GenericResponse = z.looseObject({
  new_quantity: z.number().int().nullable().optional(),
  from_user_id: z.number().int().nullable().optional(),
  to_user_id: z.number().int().nullable().optional(),
  merged: z.boolean().optional(),
  unchanged: z.boolean().optional(),
  acquisitions: z.number().int().nullable().optional(),
  instructions: z.number().int().nullable().optional(),
  papierkorb: z.union([z.number().int(), z.array(z.number().int())]).optional(),
  removed: z.number().int().nullable().optional(),
  linked_to: KontoName.nullable().optional(),
  success: z.boolean(),
  error: z.string().nullable().optional(),
  set: SetAggregate.nullable().optional(),
  parts: z.number().int().nullable().optional(),
  minifigs: z.number().int().nullable().optional(),
  source_emptied: z.boolean().optional(),
  quantity: z.number().int().nullable().optional(),
  /** Teile der Antwort, die nach einem Fehler nur Ersatzwerte tragen (etwa `kaufpreis`). */
  degradiert: z.array(z.string()).optional(),
});

export const Minifig = z.looseObject({
  id: z.number().int().nullable().optional(),
  in_sets: z.string().nullable().optional(),
  owner_ids: z.array(z.number().int()).optional(),
  set_number: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  fig_number: z.string(),
  condition: z.string().nullable().optional(),
  conditions: z.array(z.string()),
  /** Nur im Haushalt (besitzerAnhaengen); allein gibt es keine Besitzer zu nennen. */
  owners: z.array(KontoName).optional(),
  avg_purchase_price: z.number().nullable().optional(),
  fig_name: z.string().nullable().optional(),
  quantity: z.number().int(),
  total_quantity: z.number().int().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  source: z.string(),
  set_added_at: zeit.nullable().optional(),
});

export const MinifigsResponse = z.looseObject({
  success: z.boolean(),
  /** Gesamtzahl bei /minifigs, Herkunft der Liste bei den Figuren eines Sets. */
  total: z.number().int().optional(),
  source: z.string().optional(),
  figs: z.array(Minifig),
  error: z.string().nullable().optional(),
});

export const Part = z.looseObject({
  condition: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),
  part_number: z.string(),
  bl_part_number: z.string().nullable().optional(),
  part_name: z.string().nullable().optional(),
  color_id: z.number().int(),
  bl_color_id: z.number().int().nullable().optional(),
  color_name: z.string().nullable().optional(),
  color_hex: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  total_quantity: z.number().int(),
  in_sets: z.string().nullable().optional(),
  is_spare: z.boolean(),
});

export const PartValuationItem = z.looseObject({
  ausstehend: z.boolean().optional(),
  from_cache: z.boolean().optional(),
  max_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  acq_count: z.number().int().nullable().optional(),
  used_count: z.number().int().nullable().optional(),
  category_name: z.string().nullable().optional(),
  created_at: zeit.nullable().optional(),
  source: z.string().nullable().optional(),
  id: z.number().int().nullable().optional(),
  part_number: z.string(),
  bl_part_number: z.string().nullable().optional(),
  part_name: z.string().nullable().optional(),
  color_id: z.number().int(),
  color_name: z.string().nullable().optional(),
  color_hex: z.string().nullable().optional(),
  quantity: z.number().int(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  avg_purchase_price: z.number().nullable().optional(),
  qty_avg_price: veraltet(z.number().nullable().optional(), 'avg_price'),
  avg_price: z.number().nullable().optional(),
  pnl_pct: PROZENT_TEXT,
  pnl_prozent: z.number().nullable().optional(),
  display_value: veraltet(z.string().nullable().optional(), 'wert_gesamt'),
  total_value: veraltet(z.string().optional(), 'wert_gesamt'),
  wert_gesamt: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  conditions: z.array(z.string()),
  user_id: z.number().int().nullable().optional(),
  /** Nur im Haushalt (besitzerAnhaengen); allein gibt es keine Besitzer zu nennen. */
  owners: z.array(KontoName).optional(),
  acquisitions: z.array(ValuationAcquisition),
  storage: z.string().nullable().optional(),
});

export const PartsResponse = z.looseObject({
  source: z.string().nullable().optional(),
  success: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  parts: z.array(Part),
  error: z.string().nullable().optional(),
  degradiert: DEGRADIERT,
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
  error: z.string().nullable().optional(),
});

/** Löschen legt in den Papierkorb; die Kennungen holen es zurück. */
export const InDenPapierkorb = GenericResponse.extend({ papierkorb: z.array(z.number().int()) });
