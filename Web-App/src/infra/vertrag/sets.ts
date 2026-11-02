import { z } from 'zod';
import { eingabe, GROESSTE_ID } from '../validate';
import { KontoName, type Route, zeit, ganz } from './grund';
import { BrickLinkRef, CsvImportErgebnis, GenericResponse, MinifigsResponse, PartsResponse, InDenPapierkorb } from './gemeinsam';

export const AddSetResponse = z.looseObject({
  success: z.boolean().optional(),
  action: z.string().nullable().optional(),
  set_number: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  katalog_offen: z.boolean().optional(),
  error: z.string().nullable().optional(),
});

export const BarcodeResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  name: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  pieces: z.number().int().nullable().optional(),
  theme: z.string().nullable().optional(),
  minifigs: z.number().int().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  unsicher: z.boolean(),
  error: z.string().nullable().optional(),
});

export const Instruction = z.looseObject({
  id: z.number().int().nullable().optional(),
  url: z.string(),
  description: z.string().nullable().optional(),
  local_path: z.string().nullable().optional(),
  is_manual: z.boolean(),
});

export const MoveSetResponse = z.looseObject({
  success: z.boolean().optional(),
  set_number: z.string().optional(),
  quantity: z.number().int().optional(),
  acquisitions: z.number().int().optional(),
  merged: z.boolean().optional(),
  parts: z.number().int().optional(),
  minifigs: z.number().int().optional(),
  instructions: z.number().int().optional(),
  source_emptied: z.boolean().optional(),
  error: z.string().nullable().optional(),
});

export const Preisalarm = z.looseObject({
  set_number: z.string(),
  condition: z.string(),
  richtung: z.string(),
  schwelle: z.number(),
  currency_code: z.string(),
  ausgeloest: z.boolean(),
  zuletzt_am: zeit.nullable().optional(),
  zuletzt_preis: z.number().nullable().optional(),
  name: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  set_img_url: z.string().nullable().optional(),
  besitzt: z.boolean(),
});

export const PendingAlertsResponse = z.looseObject({
  success: z.boolean(),
  alerts: z.array(Preisalarm),
  now: zeit.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const PreisalarmResponse = z.looseObject({
  success: z.boolean().optional(),
  alert: Preisalarm.nullable().optional(),
  removed: z.number().int().optional(),
  error: z.string().nullable().optional(),
});

export const PreisalarmeResponse = z.looseObject({
  success: z.boolean(),
  alerts: z.array(Preisalarm),
  error: z.string().nullable().optional(),
});

export const SetItem = z.looseObject({
  set_number: z.string(),
  name: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  theme: z.string().nullable().optional(),
  pieces: z.number().int().nullable().optional(),
  minifigs: z.number().int().nullable().optional(),
  quantity: z.number().int(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  added_at: zeit.nullable().optional(),
  condition: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),
  conditions: z.array(z.string()),
  /** Nur im Haushalt (withOwners); allein gibt es keine Besitzer zu nennen. */
  owners: z.array(KontoName).optional(),
  max_purchase_price: z.number().nullable().optional(),
  avg_purchase_price: z.number().nullable().optional(),
  used_count: z.number().int().nullable().optional(),
  instructions: z.array(Instruction),
  bricklink: BrickLinkRef.nullable().optional(),
  preisvergleich_url: z.string().nullable().optional(),
});

export const SetExistsResponse = z.looseObject({
  success: z.boolean(),
  exists: z.boolean(),
  set_number: z.string(),
  owner_user_id: z.number().int().nullable().optional(),
  /** Nur, wenn es das Set im Blickfeld gibt. */
  is_self: z.boolean().optional(),
});

export const SetInfoResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  name: z.string().nullable().optional(),
});

export const SetResponse = z.looseObject({
  success: z.boolean(),
  set: SetItem.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const SetsResponse = z.looseObject({
  success: z.boolean(),
  count: z.number().int(),
  sets: z.array(SetItem),
  total: z.number().int(),
  /** Nur auf der ersten Seite eines geblätterten Abrufs. */
  themes: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});

export const AnleitungenGeladen = z.looseObject({ success: z.literal(true), count: ganz, instructions: z.array(Instruction) });
export const PdfAuftrag = z.looseObject({ success: z.literal(true), jobId: z.string() });

const textOderNull = (max: number) => z.string().max(max).nullish();
/** Der Job zeichnet jede Zeile und lädt Bilder nach: Zahl und Grösse begrenzt. */
export const PdfEingabe = z.object({
  sets: z.array(z.object({ set_number: z.string().trim().min(1).max(32), name: textOderNull(500) })).max(1000).optional(),
  parts: z.array(z.object({
    part_number: z.string().trim().min(1).max(64),
    bl_part_number: textOderNull(64),
    part_name: textOderNull(500),
    color_name: textOderNull(100),
    color_hex: z.string().regex(/^#?[0-9A-Fa-f]{0,8}$/).nullish(),
    color_id: z.number().int().min(-1).max(GROESSTE_ID).nullish(),
    quantity: z.union([z.number().int().min(1).max(9999), z.string().regex(/^[1-9]\d{0,3}$/)]),
    is_fig: z.union([z.boolean(), z.number()]).nullish(),
    image_url: textOderNull(2048),
    image_local: textOderNull(512),
  })).max(5000).optional(),
});
/** Der Stand eines PDF-Auftrags; die App fragt ihn ab, bis er fertig ist. */
export const PdfStand = z.looseObject({
  success: z.literal(true), status: z.string(), error: z.string().nullable().optional(),
  etaSeconds: z.number().nullable().optional(), missingImages: z.unknown().optional(),
});

export const TeileGeladen = z.looseObject({ success: z.literal(true), count: ganz });

export const AnleitungHochgeladen = GenericResponse.extend({
  instruction: z.looseObject({ url: z.string(), description: z.string().nullable(), local_path: z.string() }),
});

export const routen = {
  'GET /api/v1/sets/info/:setNumber': { antwort: SetInfoResponse },
  'GET /api/v1/sets': { antwort: SetsResponse },
  'GET /api/v1/sets/:setNumber': { antwort: SetResponse },
  'GET /api/v1/alerts/pending': { antwort: PendingAlertsResponse },
  'GET /api/v1/alerts': { antwort: PreisalarmeResponse },
  'GET /api/v1/sets/:setNumber/alert': { antwort: PreisalarmeResponse },
  'GET /api/v1/sets/:setNumber/parts-list': { antwort: PartsResponse },
  'GET /api/v1/sets/:setNumber/minifigs-list': { antwort: MinifigsResponse },
  'GET /api/v1/sets/exists/:setNumber': { antwort: SetExistsResponse },
  'GET /api/v1/sets/barcode/:barcode': { antwort: BarcodeResponse },
  'POST /api/v1/sets/:setNumber/instructions/upload': { antwort: AnleitungHochgeladen },
  'DELETE /api/v1/sets/:setNumber/instructions/:instrId': { antwort: GenericResponse },
  'POST /api/v1/sets': { antwort: AddSetResponse, eingabe: z.looseObject({ set_number: z.union([z.string(), z.number()]), quantity: eingabe.stueckzahl(), purchase_price: eingabe.preis('Kaufpreis') }) },
  'PUT /api/v1/sets/:setNumber': { antwort: GenericResponse },
  'DELETE /api/v1/sets/:setNumber': { antwort: InDenPapierkorb },
  'PUT /api/v1/sets/:setNumber/alert': { antwort: PreisalarmResponse },
  'DELETE /api/v1/sets/:setNumber/alert': { antwort: PreisalarmResponse },
  'POST /api/v1/sets/:sn/move': { antwort: MoveSetResponse },
  'POST /api/v1/sets/import/csv': { antwort: CsvImportErgebnis },
  'POST /api/v1/alerts/import/csv': { antwort: CsvImportErgebnis },
  'POST /api/v1/sets/:setNumber/instructions': { antwort: AnleitungenGeladen },
  'POST /api/v1/sets/partslist-pdf': { antwort: PdfAuftrag, eingabe: PdfEingabe },
  'GET /api/v1/sets/partslist-pdf/status/:jobId': { antwort: PdfStand },
  'GET /api/v1/sets/partslist-pdf/download/:jobId': { art: 'pdf' },
  'GET /api/v1/sets/partslist-pdf/stream/:jobId': { art: 'strom' },
  'POST /api/v1/sets/add-stream': { art: 'strom' },
  'GET /api/v1/sets/import/csv/stream': { art: 'strom' },
  'GET /api/v1/sets/export/rebrickable': { art: 'csv' },
  'POST /api/v1/sets/:setNumber/parts': { antwort: TeileGeladen },
} satisfies Record<string, Route>;
