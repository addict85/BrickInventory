import { z } from 'zod';
import { eingabe } from '../infra/validate';
import { type Route, zeit, Erfolg, ganz, bestaetigt, WITHOUT_BODY, KENNUNG, TEXT, ZUSTAND, abfrage, Q } from './base';
/** One account or several, separated by commas (storage locations via the household). */
const STORAGE_ACCOUNTS = z.string().regex(/^[0-9,]{0,200}$/);
import { DEGRADED, Erfassungsantwort } from './shared';

export { Erfassungsantwort };

export const Acquisition = z.looseObject({
  id: z.number().int(),
  quantity: z.number().int(),
  purchase_price: z.number().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  condition: z.string(),
  created_at: zeit.nullable(),
  owner_user_id: z.number().int(),
  price_estimated: z.boolean(),
  currency: z.string().nullable(),
  /** The price in the account's currency (rate of the purchase day); null without a price or without a rate. */
  preis_konto: z.number().nullable(),
});

export const AcquisitionTotals = z.looseObject({
  quantity: z.number().int(),
  /** Sum in `currency`; foreign currencies converted, not included without a rate. Missing without a price. */
  amount: z.number().optional(),
  priced_rows: z.number().int(),
  currency: z.string().optional(),
  ohne_kurs: z.number().int().optional(),
});

export const AcquisitionsResponse = z.looseObject({
  success: z.boolean(),
  /** The asking account; missing if reading failed. */
  owner_user_id: z.number().int().optional(),
  acquisitions: z.array(Acquisition),
  totals: AcquisitionTotals,
  degradiert: DEGRADED,
});

export const DeleteWithQuantityResponse = z.looseObject({
  success: z.boolean(),
  new_quantity: z.number().int().optional(),
});

export const Lagerort = z.looseObject({
  figuren: z.number().int().nullable(),
  ort: z.string(),
  sets: z.number().int(),
  teile: z.number().int(),
});

export const LagerortEintrag = z.looseObject({
  id: z.number().int(),
  user_id: z.number().int(),
  name: z.string(),
});

export const LagerortEintragResponse = z.looseObject({
  success: z.boolean(),
  ort: LagerortEintrag.nullable(),
});

export const LagerortResponse = z.looseObject({
  success: z.boolean(),
  storage: z.string().nullable().optional(),
  changed: z.number().int().optional(),
});

export const LagerortVorgabeResponse = z.looseObject({
  success: z.boolean(),
  vorgabe: LagerortEintrag.nullable(),
});

export const LagerortVorratResponse = z.looseObject({
  success: z.boolean(),
  orte: z.array(LagerortEintrag),
  vorgabe: LagerortEintrag.nullable(),
});

export const LagerorteResponse = z.looseObject({
  success: z.boolean(),
  orte: z.array(Lagerort),
});

export const PapierkorbEintrag = z.looseObject({
  id: ganz,
  type: z.enum(['set', 'teil', 'figur']),
  number: z.string(),
  color_id: ganz.nullable(),
  label: z.string().nullable(),
  anzahl: ganz,
  user_id: ganz,
  deleted_at: zeit,
  endgueltig_am: zeit,
});
export const Papierkorb = z.looseObject({ success: z.literal(true), eintraege: z.array(PapierkorbEintrag) });
export const Wiederhergestellt = z.looseObject({
  success: z.literal(true),
  type: z.enum(['set', 'teil', 'figur']),
  number: z.string(),
  user_id: ganz,
});
export const PapierkorbGeleert = z.looseObject({ success: z.literal(true), entfernt: ganz });
/** What "empty inventory" put into the trash, with the identifiers for restoring. */
export const BestandGeleert = z.looseObject({
  success: z.literal(true),
  sets: ganz,
  teile: ganz,
  figuren: ganz,
  papierkorb: z.array(ganz),
});

/** The price is called purchase_price for sets, otherwise unit_price; the app sends both. */
const Erfassungsaenderung = z.strictObject({
  quantity: eingabe.quantityOrNothing(1, 100_000),
  purchase_price: eingabe.geld('Kaufpreis'),
  unit_price: eingabe.geld('Stückpreis'),
  condition: ZUSTAND.nullable().optional(),
  date: TEXT(40).nullable().optional(),
  owner_user_id: KENNUNG.nullable().optional(),
  from_user_id: KENNUNG.nullable()
    .optional()
    .meta({ deprecated: true, description: 'wird nicht ausgewertet: Der Besitzer kommt aus der Zeile' }),
});

export const routen = {
  'GET /api/v1/sets/:setNumber/acquisitions': {
    klein: true,
    antwort: AcquisitionsResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/parts/:partNumber/:colorId/acquisitions': {
    klein: true,
    antwort: AcquisitionsResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/minifigs/:figNumber/acquisitions': {
    klein: true,
    antwort: AcquisitionsResponse,
    abfrage: abfrage({ accounts: Q.konten }),
  },
  'GET /api/v1/storage/locations': {
    klein: true,
    antwort: LagerortVorratResponse,
    abfrage: abfrage({
      owner: STORAGE_ACCOUNTS,
      accounts: Q.konten.meta({ deprecated: true, description: 'wird nicht ausgewertet: Die Liste folgt dem Recht' }),
    }),
  },
  'GET /api/v1/storage': { klein: true, antwort: LagerorteResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'PUT /api/v1/minifigs/:figNumber/storage': {
    eingabe: z.strictObject({ storage: TEXT().nullable().optional() }),
    antwort: LagerortResponse,
  },
  'PUT /api/v1/sets/:setNumber/acquisitions/:acqId': { antwort: Erfassungsantwort, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId': { eingabe: WITHOUT_BODY, antwort: Erfassungsantwort },
  'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': {
    antwort: Erfassungsantwort,
    eingabe: Erfassungsaenderung,
  },
  'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': {
    eingabe: WITHOUT_BODY,
    antwort: DeleteWithQuantityResponse,
  },
  'PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId': { antwort: Erfassungsantwort, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId': {
    eingabe: WITHOUT_BODY,
    antwort: DeleteWithQuantityResponse,
  },
  'PUT /api/v1/sets/:setNumber/storage': {
    eingabe: z.strictObject({ storage: TEXT().nullable().optional() }),
    antwort: LagerortResponse,
  },
  'PUT /api/v1/parts/:partNumber/:colorId/storage': {
    eingabe: z.strictObject({ storage: TEXT().nullable().optional() }),
    antwort: LagerortResponse,
  },
  'POST /api/v1/storage/locations': {
    eingabe: z.strictObject({ name: TEXT().optional(), owner: KENNUNG.optional() }),
    antwort: LagerortEintragResponse,
    abfrage: abfrage({ owner: STORAGE_ACCOUNTS }),
  },
  'PUT /api/v1/storage/locations/:id': {
    eingabe: z.strictObject({ name: TEXT().optional(), owner: KENNUNG.optional() }),
    antwort: LagerortEintragResponse,
    abfrage: abfrage({ owner: STORAGE_ACCOUNTS }),
  },
  'DELETE /api/v1/storage/locations/:id': {
    eingabe: WITHOUT_BODY,
    antwort: LagerortResponse,
    abfrage: abfrage({ owner: STORAGE_ACCOUNTS }),
  },
  'PUT /api/v1/storage/default': {
    eingabe: z.strictObject({ id: KENNUNG.nullable().optional() }),
    antwort: LagerortVorgabeResponse,
  },
  'GET /api/v1/papierkorb': { klein: true, antwort: Papierkorb },
  'POST /api/v1/papierkorb/:id/wiederherstellen': { eingabe: WITHOUT_BODY, antwort: Wiederhergestellt },
  'DELETE /api/v1/papierkorb/:id': { antwort: Erfolg, ...bestaetigt() },
  'DELETE /api/v1/papierkorb': { antwort: PapierkorbGeleert, ...bestaetigt() },
  'DELETE /api/v1/bestand': { antwort: BestandGeleert, ...bestaetigt() },
} satisfies Record<string, Route>;
