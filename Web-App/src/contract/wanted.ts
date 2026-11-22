import { z } from 'zod';
import { input } from '../infra/validate';
import {
  type Route,
  time,
  whole,
  WITHOUT_BODY,
  IDENTIFIER,
  TEXT,
  CONDITION,
  query,
  Q,
  PAGE,
  PAGES_DETAIL,
} from './base';
import { CsvImportResult, DEGRADED, GenericResponse } from './shared';

export const CurrentPrice = z.looseObject({
  condition: z.string(),
  avg_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
  fetched_at: time.nullable().optional(),
});

export const CurrentByCondition = z.looseObject({
  N: CurrentPrice.nullable().optional(),
  U: CurrentPrice.nullable().optional(),
});

export const WantedItemAlert = z.looseObject({
  direction: z.string(),
  threshold: z.number(),
  triggered: z.boolean(),
});

export const WantedItem = z.looseObject({
  theme_id: z.number().int().nullable(),
  set_number: z.string(),
  condition: z.string(),
  created_at: time,
  user_id: z.number().int(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  num_parts: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  marktpreis: z.number().nullable(),
  waehrung: z.string(),
  owned: z.boolean(),
  alarm: WantedItemAlert.nullable(),
  preisvergleich_url: z.string().nullable(),
});

export const WantedListResponse = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  merkposten: z.array(WantedItem),
});

export const WantedItemReply = z.looseObject({
  success: z.boolean(),
  war_neu: z.boolean(),
  merkposten: WantedItem.nullable(),
});

export const WantedItemOwnerReply = z.looseObject({
  success: z.boolean(),
  verschoben: z.boolean(),
  zusammengefuehrt: z.boolean(),
  owner_user_id: z.number().int().nullable(),
});

export const WantedItemPricesResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  currency: z.string(),
  current: CurrentByCondition,
  degradiert: DEGRADED,
});

export const WantedItemTakeoverResponse = z.looseObject({
  katalog_offen: z.boolean().optional(),
  name: z.string().nullable().optional(),
  success: z.boolean(),
  action: z.string().nullable(),
  set_number: z.string().nullable(),
});

/** Reading in a BrickLink wanted list; with `vorschau` without saving. */
export const WantedXmlResult = z.looseObject({
  success: z.literal(true),
  vorschau: z.boolean(),
  gelesen: whole,
  angelegt: whole,
  aufgestockt: whole,
  fehler: whole,
  posten: z.array(
    z.looseObject({
      art: z.string(),
      blId: z.string(),
      menge: whole,
      ausgang: z.string(),
      blFarbe: whole.nullable().optional(),
      rbId: z.string().nullable().optional(),
      rbFarbe: whole.nullable().optional(),
      farbName: z.string().nullable().optional(),
      farbHex: z.string().nullable().optional(),
      sicherheit: z.string().nullable().optional(),
      zustand: z.string().nullable().optional(),
      maxPreis: z.number().nullable().optional(),
      name: z.string().nullable().optional(),
      nameGeraten: z.boolean().optional(),
      bild: z.string().nullable().optional(),
      grund: z.string().nullable().optional(),
      grundCode: z.string().nullable().optional(),
    }),
  ),
  offen: z.array(z.looseObject({ art: z.string(), blId: z.string(), blFarbe: whole.nullable().optional() })),
  fremdeArten: z.record(z.string(), whole).optional(),
  ohneNummer: whole.optional(),
  stufen: z.record(z.string(), whole).optional(),
  farbeOffen: whole.optional(),
  standardZustand: z.string().optional(),
  abgebrochen: z.boolean().optional(),
  korrekturen: z.looseObject({ angewandt: whole, abgewiesen: z.array(z.unknown()) }).optional(),
  rebrickable: z
    .looseObject({
      gefragt: whole,
      gefunden: whole,
      filterWirkungslos: z.boolean(),
      abgebrochen: z.enum(['kontingent', 'kein_schluessel', 'stoerung']).optional(),
    })
    .optional(),
});

export const MerkpostenGeloescht = GenericResponse.extend({ geloescht: whole });

export const routen = {
  'GET /api/v1/wanted': {
    antwort: WantedListResponse,
    abfrage: query({
      accounts: Q.konten,
      search: Q.text(),
      condition: z.enum(['N', 'U', 'n', 'u', '']),
      sort: Q.text(40),
      ...PAGE,
    }),
  },
  'GET /api/v1/wanted/:setNumber/preise': { klein: true, antwort: WantedItemPricesResponse },
  'POST /api/v1/wanted': {
    eingabe: z.strictObject({
      set_number: TEXT(40),
      condition: CONDITION.nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
    }),
    antwort: WantedItemReply,
  },
  'PUT /api/v1/wanted/:setNumber/:condition/inhaber': {
    eingabe: z.strictObject({ owner_user_id: IDENTIFIER.nullable().optional(), neuer_inhaber: IDENTIFIER }),
    antwort: WantedItemOwnerReply,
  },
  'DELETE /api/v1/wanted/:setNumber/:condition': {
    eingabe: WITHOUT_BODY,
    antwort: MerkpostenGeloescht,
    abfrage: query({ owner_user_id: Q.konto }),
  },
  'POST /api/v1/wanted/:setNumber/:condition/uebernehmen': {
    antwort: WantedItemTakeoverResponse,
    eingabe: z.strictObject({
      quantity: input.stueckzahl(),
      purchase_price: input.geld('Kaufpreis'),
      condition: CONDITION.nullable().optional(),
      owner_user_id: IDENTIFIER.nullable().optional(),
      storage: TEXT().nullable().optional(),
    }),
  },
  'POST /api/v1/wanted/import/csv': {
    formular: true,
    antwort: CsvImportResult,
    eingabe: z.strictObject({ owner_user_id: Q.konto.optional() }),
  },
  'POST /api/v1/wanted-list/import/xml': {
    antwort: WantedXmlResult,
    formular: true,
    eingabe: z.strictObject({ korrekturen: z.string().max(5_000_000).optional() }),
    abfrage: query({ schreiben: Q.schalter, rebrickable: Q.schalter, strom: Q.schalter }),
  },
} satisfies Record<string, Route>;
