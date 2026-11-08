import { z } from 'zod';
import { eingabe } from '../infra/validate';
import { type Route, zeit, ganz, OHNE_RUMPF, KENNUNG, TEXT, ZUSTAND, abfrage, Q, SEITE, SEITEN_ANGABE } from './grund';
import { CsvImportErgebnis, GenericResponse } from './gemeinsam';

export const CurrentPrice = z.looseObject({
  condition: z.string(),
  avg_price: z.number().nullable().optional(),
  min_price: z.number().nullable().optional(),
  max_price: z.number().nullable().optional(),
  fetched_at: zeit.nullable().optional(),
});

export const CurrentByCondition = z.looseObject({
  N: CurrentPrice.nullable().optional(),
  U: CurrentPrice.nullable().optional(),
});

export const MerkpostenAlarm = z.looseObject({
  richtung: z.string(),
  schwelle: z.number(),
  ausgeloest: z.boolean(),
});

export const Merkposten = z.looseObject({
  set_number: z.string(),
  condition: z.string(),
  created_at: zeit.nullable().optional(),
  user_id: z.number().int(),
  name: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  num_parts: z.number().int().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  marktpreis: z.number().nullable().optional(),
  waehrung: z.string(),
  owned: z.boolean(),
  alarm: MerkpostenAlarm.nullable().optional(),
  preisvergleich_url: z.string().nullable().optional(),
});

export const MerklisteResponse = z.looseObject({
  success: z.boolean(),
  ...SEITEN_ANGABE,
  merkposten: z.array(Merkposten),
  error: z.string().nullable().optional(),
});

export const MerkpostenAntwort = z.looseObject({
  success: z.boolean().optional(),
  war_neu: z.boolean().optional(),
  merkposten: Merkposten.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const MerkpostenInhaberAntwort = z.looseObject({
  success: z.boolean().optional(),
  verschoben: z.boolean().optional(),
  zusammengefuehrt: z.boolean().optional(),
  owner_user_id: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const MerkpostenPreiseResponse = z.looseObject({
  success: z.boolean(),
  set_number: z.string(),
  currency: z.string(),
  current: CurrentByCondition,
  error: z.string().nullable().optional(),
});

export const MerkpostenUebernahmeResponse = z.looseObject({
  success: z.boolean().optional(),
  action: z.string().nullable().optional(),
  set_number: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** Einlesen einer BrickLink-Wanted-List; mit `vorschau` ohne zu speichern. */
export const WantedXmlErgebnis = z.looseObject({
  success: z.literal(true), vorschau: z.boolean(), gelesen: ganz, angelegt: ganz, aufgestockt: ganz, fehler: ganz,
  posten: z.array(z.looseObject({ art: z.string(), blId: z.string(), menge: ganz, ausgang: z.string() })),
  offen: z.array(z.looseObject({ art: z.string(), blId: z.string() })),
});

export const MerkpostenGeloescht = GenericResponse.extend({ geloescht: ganz });

export const routen = {
  'GET /api/v1/wanted': { antwort: MerklisteResponse, abfrage: abfrage({ accounts: Q.konten, search: Q.text(),
    condition: z.enum(['N', 'U', 'n', 'u', '']), sort: Q.text(40), ...SEITE }) },
  'GET /api/v1/wanted/:setNumber/preise': { antwort: MerkpostenPreiseResponse },
  'POST /api/v1/wanted': { eingabe: z.strictObject({ set_number: TEXT(40), condition: ZUSTAND.nullable().optional(), owner_user_id: KENNUNG.nullable().optional() }), antwort: MerkpostenAntwort },
  'PUT /api/v1/wanted/:setNumber/:condition/inhaber': { eingabe: z.strictObject({ owner_user_id: KENNUNG.nullable().optional(), neuer_inhaber: KENNUNG }), antwort: MerkpostenInhaberAntwort },
  'DELETE /api/v1/wanted/:setNumber/:condition': { eingabe: OHNE_RUMPF, antwort: MerkpostenGeloescht,
    abfrage: abfrage({ owner_user_id: Q.konto }) },
  'POST /api/v1/wanted/:setNumber/:condition/uebernehmen': { antwort: MerkpostenUebernahmeResponse, eingabe: z.strictObject({
    quantity: eingabe.stueckzahl(), purchase_price: eingabe.geld('Kaufpreis'), condition: ZUSTAND.nullable().optional(),
    owner_user_id: KENNUNG.nullable().optional(), storage: TEXT().nullable().optional() }) },
  'POST /api/v1/wanted/import/csv': { formular: true, antwort: CsvImportErgebnis,
    eingabe: z.strictObject({ owner_user_id: Q.konto.optional() }) },
  'POST /api/v1/wanted-list/import/xml': { antwort: WantedXmlErgebnis, formular: true,
    eingabe: z.strictObject({ korrekturen: z.string().max(5_000_000).optional() }),
    abfrage: abfrage({ schreiben: Q.schalter, rebrickable: Q.schalter, strom: Q.schalter }) },
} satisfies Record<string, Route>;
