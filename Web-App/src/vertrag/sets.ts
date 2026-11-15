import { z } from 'zod';
import { eingabe, GROESSTE_ID } from '../infra/validate';
import { KontoName, type Route, zeit, ganz, OHNE_RUMPF, KENNUNG, ZUSTAND, TEXT, abfrage, Q } from './grund';
import {
  BrickLinkRef,
  CsvImportErgebnis,
  DEGRADIERT,
  GenericResponse,
  SetFigurenResponse,
  SetTeileResponse,
  InDenPapierkorb,
} from './gemeinsam';

export { GenericResponse, SetFigurenResponse, SetTeileResponse };

export const AddSetResponse = z.looseObject({
  success: z.boolean(),
  action: z.string(),
  set_number: z.string(),
  name: z.string().nullable().optional(),
  katalog_offen: z.boolean().optional(),
  /** ausstehend: angelegt, Katalog, Bild oder Marktpreis holt noch ein Auftrag. */
  ergaenzung: z.enum(['ausstehend', 'erledigt']).optional(),
  owner_user_id: z.number().int().optional(),
  is_self: z.boolean().optional(),
});

export const BarcodeResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  pieces: z.number().int().nullable(),
  theme: z.string().nullable(),
  minifigs: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  source: z.string().nullable(),
  unsicher: z.boolean(),
});

export const Instruction = z.looseObject({
  downloaded_at: zeit.nullable().optional(),
  fetched_at: zeit.nullable().optional(),
  set_number: z.string(),
  user_id: z.number().int().nullable().optional(),
  id: z.number().int(),
  url: z.string(),
  description: z.string().nullable(),
  local_path: z.string().nullable(),
  is_manual: z.boolean(),
});

export const MoveSetResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  quantity: z.number().int(),
  acquisitions: z.number().int(),
  merged: z.boolean(),
  parts: z.number().int(),
  minifigs: z.number().int(),
  instructions: z.number().int(),
  source_emptied: z.boolean(),
  from_user_id: z.number().int(),
  to_user_id: z.number().int(),
});

export const Preisalarm = z.looseObject({
  set_number: z.string(),
  condition: z.string(),
  richtung: z.string(),
  schwelle: z.number(),
  currency_code: z.string(),
  ausgeloest: z.boolean(),
  zuletzt_am: zeit.nullable(),
  zuletzt_preis: z.number().nullable(),
  name: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  set_img_url: z.string().nullable().optional(),
  besitzt: z.boolean(),
});

export const PendingAlertsResponse = z.looseObject({
  success: z.boolean(),
  alerts: z.array(Preisalarm),
  now: zeit.nullable(),
});

export const PreisalarmResponse = z.looseObject({
  success: z.boolean(),
  alert: Preisalarm.nullable().optional(),
  removed: z.number().int().optional(),
});

export const PreisalarmeResponse = z.looseObject({
  success: z.boolean(),
  alerts: z.array(Preisalarm),
});

export const SetItem = z.looseObject({
  acq_count: z.number().int(),
  letzter_kauf: zeit.nullable().optional(),
  owner_ids: z.array(z.number().int()).optional(),
  id: z.number().int().optional(),
  storage_id: z.number().int().nullable().optional(),
  updated_at: zeit.nullable().optional(),
  user_id: z.number().int().optional(),
  set_number: z.string(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  theme: z.string().nullable(),
  pieces: z.number().int().nullable(),
  minifigs: z.number().int().nullable(),
  quantity: z.number().int(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  added_at: zeit.nullable(),
  condition: z.string().nullable(),
  storage: z.string().nullable(),
  conditions: z.array(z.string()),
  /** Nur im Haushalt (besitzerAnhaengen); allein gibt es keine Besitzer zu nennen. */
  owners: z.array(KontoName).optional(),
  max_purchase_price: z.number().nullable(),
  avg_purchase_price: z.number().nullable(),
  kaufpreis_geschaetzt: z.boolean().nullable().optional(),
  used_count: z.number().int(),
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
  image_local: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  minifigs: z.number().int().nullable().optional(),
  pieces: z.number().int().nullable().optional(),
  theme: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  success: z.boolean(),
  set_number: z.string(),
  name: z.string().nullable(),
  im_katalog: z.boolean(),
});

export const SetResponse = z.looseObject({
  success: z.boolean(),
  set: SetItem.nullable(),
});

export const SetsResponse = z.looseObject({
  success: z.boolean(),
  count: z.number().int(),
  sets: z.array(SetItem),
  total: z.number().int(),
  /** Nur auf der ersten Seite eines geblätterten Abrufs. */
  themes: z.array(z.string()).optional(),
});

/** 202: Geladen wird im Job-Prozess (Auftrag `anleitung`); die Liste ist der Stand vor dem Laden. */
export const AnleitungenGeladen = z.looseObject({
  success: z.literal(true),
  count: ganz,
  instructions: z.array(Instruction),
  auftrag_id: z.string().nullable(),
});
export const PdfAuftrag = z.looseObject({ success: z.literal(true), jobId: z.string() });

const textOderNull = (max: number) => z.string().max(max).nullish();
/** Der Job zeichnet jede Zeile und lädt Bilder nach: Zahl und Grösse begrenzt. */
export const PdfEingabe = z.strictObject({
  sets: z
    .array(z.object({ set_number: z.string().trim().min(1).max(32), name: textOderNull(500) }))
    .max(1000)
    .optional(),
  parts: z
    .array(
      z.object({
        part_number: z.string().trim().min(1).max(64),
        bl_part_number: textOderNull(64),
        part_name: textOderNull(500),
        color_name: textOderNull(100),
        color_hex: z
          .string()
          .regex(/^#?[0-9A-Fa-f]{0,8}$/)
          .nullish(),
        color_id: z.number().int().min(-1).max(GROESSTE_ID).nullish(),
        quantity: z.union([z.number().int().min(1).max(9999), z.string().regex(/^[1-9]\d{0,3}$/)]),
        is_fig: z.union([z.boolean(), z.number()]).nullish(),
        image_url: textOderNull(2048),
        image_local: textOderNull(512),
      }),
    )
    .max(5000)
    .optional(),
});
/** Der Stand eines PDF-Auftrags; die App fragt ihn ab, bis er fertig ist. */
export const PdfStand = z.looseObject({
  success: z.literal(true),
  status: z.string(),
  error: z.string().nullable(),
  etaSeconds: z.number().nullable(),
  missingImages: z.unknown(),
});

/** Der Set-Import läuft im Hintergrund; sofort steht fest, wie viele Zeilen und welche Sets schon da sind. */
export const SetCsvImportGestartet = z.looseObject({
  success: z.boolean(),
  total: ganz,
  /** false bei `pruefen`: nur gezählt, nichts gestartet. */
  gestartet: z.boolean(),
  vorhanden: ganz,
  vorhanden_nummern: z.array(z.string()),
  skipped: ganz.optional(),
  skipped_hint: z.string().optional(),
});

export const TeileGeladen = z.looseObject({ success: z.literal(true), count: ganz });

export const AnleitungHochgeladen = GenericResponse.extend({
  instruction: z.looseObject({ url: z.string(), description: z.string().nullable(), local_path: z.string() }),
});

/** Was eine Verringerung wegnahm; die Oberfläche nennt den Kauf und bietet Rückgängig über `papierkorb`. */
export const MengeGeaendert = GenericResponse.extend({
  /** null: geschrieben, aber nicht nachgelesen (siehe degradiert). */
  quantity: ganz.nullable(),
  papierkorb: z.number().int().optional(),
  degradiert: DEGRADIERT,
  entfallen: z
    .array(
      z.looseObject({
        id: ganz,
        quantity: ganz,
        purchase_price: z.number().nullable(),
        currency: z.string().nullable(),
        price_estimated: z.boolean(),
        condition: z.string(),
        date: z.string().nullable(),
      }),
    )
    .optional(),
});

/** Ein neues Set; dieselben Felder für den Strom (add-stream). */
const NeuesSet = z.strictObject({
  set_number: z.union([z.string().max(64), z.number()]).optional(),
  quantity: eingabe.stueckzahl(),
  purchase_price: eingabe.geld('Kaufpreis'),
  condition: ZUSTAND.nullable().optional(),
  owner_user_id: KENNUNG.nullable().optional(),
  storage: TEXT().nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const routen = {
  'GET /api/v1/sets/info/:setNumber': { antwort: SetInfoResponse },
  'GET /api/v1/sets': {
    antwort: SetsResponse,
    abfrage: abfrage({
      accounts: Q.konten,
      search: Q.text(),
      theme: Q.text(),
      sort: Q.text(40),
      page: Q.zahl(),
      page_size: Q.zahl(),
      storage: Q.text(),
    }),
  },
  'GET /api/v1/sets/:setNumber': { antwort: SetResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/alerts/pending': {
    klein: true,
    antwort: PendingAlertsResponse,
    abfrage: abfrage({ since: Q.text(40) }),
  },
  'GET /api/v1/alerts': { klein: true, antwort: PreisalarmeResponse },
  'GET /api/v1/sets/:setNumber/alert': { klein: true, antwort: PreisalarmeResponse },
  'GET /api/v1/sets/:setNumber/parts-list': { klein: true, antwort: SetTeileResponse },
  'GET /api/v1/sets/:setNumber/minifigs-list': { klein: true, antwort: SetFigurenResponse },
  'GET /api/v1/sets/exists/:setNumber': { antwort: SetExistsResponse },
  'GET /api/v1/sets/barcode/:barcode': { antwort: BarcodeResponse },
  'POST /api/v1/sets/:setNumber/instructions/upload': {
    antwort: AnleitungHochgeladen,
    formular: true,
    eingabe: z.strictObject({ description: TEXT(500).optional() }),
  },
  'DELETE /api/v1/sets/:setNumber/instructions/:instrId': { eingabe: OHNE_RUMPF, antwort: GenericResponse },
  'POST /api/v1/sets': { antwort: AddSetResponse, eingabe: NeuesSet },
  'PUT /api/v1/sets/:setNumber': {
    eingabe: z.strictObject({
      quantity: eingabe.mengeOderNichts(0, 100_000).optional(),
      quantity_delta: eingabe.mengenDelta(),
      purchase_price: eingabe.geld('Kaufpreis'),
      condition: ZUSTAND.nullable().optional(),
      owner_user_id: KENNUNG.nullable().optional(),
    }),
    antwort: MengeGeaendert,
  },
  'DELETE /api/v1/sets/:setNumber': {
    eingabe: OHNE_RUMPF,
    antwort: InDenPapierkorb,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'PUT /api/v1/sets/:setNumber/alert': {
    eingabe: z.strictObject({
      richtung: z.enum(['unter', 'ueber']),
      schwelle: eingabe.geld('Schwelle', { nullbar: false }),
      condition: ZUSTAND.optional(),
    }),
    antwort: PreisalarmResponse,
  },
  'DELETE /api/v1/sets/:setNumber/alert': {
    eingabe: OHNE_RUMPF,
    antwort: PreisalarmResponse,
    abfrage: abfrage({ condition: z.enum(['N', 'U', 'n', 'u']) }),
  },
  'POST /api/v1/sets/:sn/move': {
    eingabe: z.strictObject({
      from_user_id: KENNUNG.nullable().optional(),
      to_user_id: KENNUNG,
      acquisition_ids: z.array(KENNUNG).max(10_000).nullable().optional(),
    }),
    antwort: MoveSetResponse,
  },
  'POST /api/v1/sets/import/csv': {
    formular: true,
    antwort: SetCsvImportGestartet,
    abfrage: abfrage({ pruefen: Q.schalter }),
  },
  'POST /api/v1/alerts/import/csv': { formular: true, antwort: CsvImportErgebnis },
  'POST /api/v1/sets/:setNumber/instructions': { eingabe: OHNE_RUMPF, antwort: AnleitungenGeladen },
  'POST /api/v1/sets/partslist-pdf': { antwort: PdfAuftrag, eingabe: PdfEingabe },
  'GET /api/v1/sets/partslist-pdf/status/:jobId': { antwort: PdfStand },
  'GET /api/v1/sets/partslist-pdf/download/:jobId': { art: 'pdf' },
  'GET /api/v1/sets/partslist-pdf/stream/:jobId': { art: 'strom' },
  'POST /api/v1/sets/add-stream': { art: 'strom', eingabe: NeuesSet },
  'GET /api/v1/sets/import/csv/stream': { art: 'strom', abfrage: abfrage({ sprache: Q.text(2) }) },
  'GET /api/v1/sets/export/rebrickable': { art: 'csv' },
  'POST /api/v1/sets/:setNumber/parts': { eingabe: OHNE_RUMPF, antwort: TeileGeladen },
} satisfies Record<string, Route>;
