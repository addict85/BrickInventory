import { z } from 'zod';
import { eingabe } from '../infra/validate';
import { type Route, zeit, ganz, OHNE_RUMPF, KENNUNG, TEXT, ZUSTAND, abfrage, Q, SEITE, SEITEN_ANGABE } from './grund';
import { CsvImportErgebnis, DEGRADIERT, GenericResponse } from './gemeinsam';

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
  theme_id: z.number().int().nullable().optional(),
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
  degradiert: DEGRADIERT,
});

export const MerkpostenUebernahmeResponse = z.looseObject({
  katalog_offen: z.boolean().optional(),
  name: z.string().nullable().optional(),
  success: z.boolean().optional(),
  action: z.string().nullable().optional(),
  set_number: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** Einlesen einer BrickLink-Wanted-List; mit `vorschau` ohne zu speichern. */
export const WantedXmlErgebnis = z.looseObject({
  success: z.literal(true), vorschau: z.boolean(), gelesen: ganz, angelegt: ganz, aufgestockt: ganz, fehler: ganz,
  posten: z.array(z.looseObject({ art: z.string(), blId: z.string(), menge: ganz, ausgang: z.string(),
    blFarbe: ganz.nullable().optional(), rbId: z.string().nullable().optional(), rbFarbe: ganz.nullable().optional(),
    farbName: z.string().nullable().optional(), farbHex: z.string().nullable().optional(),
    sicherheit: z.string().nullable().optional(), zustand: z.string().nullable().optional(),
    maxPreis: z.number().nullable().optional(), name: z.string().nullable().optional(),
    nameGeraten: z.boolean().optional(), bild: z.string().nullable().optional(),
    grund: z.string().nullable().optional(), grundCode: z.string().nullable().optional() })),
  offen: z.array(z.looseObject({ art: z.string(), blId: z.string(), blFarbe: ganz.nullable().optional() })),
  fremdeArten: z.record(z.string(), ganz).optional(), ohneNummer: ganz.optional(),
  stufen: z.record(z.string(), ganz).optional(), farbeOffen: ganz.optional(), standardZustand: z.string().optional(),
  abgebrochen: z.boolean().optional(),
  korrekturen: z.looseObject({ angewandt: ganz, abgewiesen: z.array(z.unknown()) }).optional(),
  rebrickable: z.looseObject({ gefragt: ganz, gefunden: ganz, filterWirkungslos: z.boolean(),
    abgebrochen: z.enum(['kontingent', 'kein_schluessel', 'stoerung']).optional() }).optional(),
});

export const MerkpostenGeloescht = GenericResponse.extend({ geloescht: ganz });

export const routen = {
  'GET /api/v1/wanted': { antwort: MerklisteResponse, abfrage: abfrage({ accounts: Q.konten, search: Q.text(),
    condition: z.enum(['N', 'U', 'n', 'u', '']), sort: Q.text(40), ...SEITE }) },
  'GET /api/v1/wanted/:setNumber/preise': { klein: true, antwort: MerkpostenPreiseResponse },
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
