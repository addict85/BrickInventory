import { z } from 'zod';
import { eingabe } from '../infra/validate';
import { type Route, zeit, Erfolg, ganz, bestaetigt, OHNE_RUMPF, KENNUNG, TEXT, ZUSTAND, abfrage, Q } from './grund';
/** Ein Konto oder mehrere, durch Komma getrennt (Lagerorte über den Haushalt). */
const LAGER_KONTEN = z.string().regex(/^[0-9,]{0,200}$/);
import { GenericResponse } from './gemeinsam';

export const Acquisition = z.looseObject({
  id: z.number().int(),
  quantity: z.number().int(),
  purchase_price: z.number().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  condition: z.string(),
  created_at: zeit.nullable().optional(),
  owner_user_id: z.number().int().nullable().optional(),
  price_estimated: z.boolean(),
  currency: z.string().nullable().optional(),
  /** Der Preis in der Währung des Kontos (Kurs des Kauftags); null ohne Preis oder ohne Kurs. */
  preis_konto: z.number().nullable().optional(),
});

export const AcquisitionTotals = z.looseObject({
  quantity: z.number().int(),
  /** Summe in `currency`; fremde Währungen umgerechnet, ohne Kurs nicht eingerechnet. Ohne Preis fehlt sie. */
  amount: z.number().optional(),
  priced_rows: z.number().int(),
  currency: z.string().optional(),
  ohne_kurs: z.number().int().optional(),
});

export const AcquisitionsResponse = z.looseObject({
  success: z.boolean(),
  /** Das fragende Konto; fehlt, wenn das Lesen scheiterte. */
  owner_user_id: z.number().int().optional(),
  acquisitions: z.array(Acquisition),
  totals: AcquisitionTotals,
});

export const DeleteWithQuantityResponse = z.looseObject({
  success: z.boolean(),
  new_quantity: z.number().int().optional(),
});

export const Lagerort = z.looseObject({
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
  success: z.boolean().optional(),
  ort: LagerortEintrag.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const LagerortResponse = z.looseObject({
  success: z.boolean().optional(),
  storage: z.string().nullable().optional(),
  changed: z.number().int().optional(),
  error: z.string().nullable().optional(),
});

export const LagerortVorgabeResponse = z.looseObject({
  success: z.boolean().optional(),
  vorgabe: LagerortEintrag.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const LagerortVorratResponse = z.looseObject({
  success: z.boolean(),
  orte: z.array(LagerortEintrag),
  vorgabe: LagerortEintrag.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const LagerorteResponse = z.looseObject({
  success: z.boolean(),
  orte: z.array(Lagerort),
  error: z.string().nullable().optional(),
});

export const PapierkorbEintrag = z.looseObject({
  id: ganz, art: z.enum(['set', 'teil', 'figur']), nummer: z.string(), farbe_id: ganz.nullable(),
  bezeichnung: z.string().nullable(), anzahl: ganz, user_id: ganz, geloescht_am: zeit, endgueltig_am: zeit,
});
export const Papierkorb = z.looseObject({ success: z.literal(true), eintraege: z.array(PapierkorbEintrag) });
export const Wiederhergestellt = z.looseObject({
  success: z.literal(true), art: z.enum(['set', 'teil', 'figur']), nummer: z.string(), user_id: ganz,
});
export const PapierkorbGeleert = z.looseObject({ success: z.literal(true), entfernt: ganz });
/** Was „Bestand leeren“ in den Papierkorb gelegt hat, mit den Kennungen zum Zurückholen. */
export const BestandGeleert = z.looseObject({
  success: z.literal(true), sets: ganz, teile: ganz, figuren: ganz, papierkorb: z.array(ganz),
});

/** Der Preis heisst bei Sets purchase_price, sonst unit_price; die App schickt beide. */
const Erfassungsaenderung = z.strictObject({ quantity: eingabe.mengeOderNichts(1, 100_000),
  purchase_price: eingabe.geld('Kaufpreis'), unit_price: eingabe.geld('Stückpreis'), condition: ZUSTAND.nullable().optional(),
  date: TEXT(40).nullable().optional(), owner_user_id: KENNUNG.nullable().optional(),
  from_user_id: KENNUNG.nullable().optional().meta({ deprecated: true, description: 'wird nicht ausgewertet: Der Besitzer kommt aus der Zeile' }) });

export const routen = {
  'GET /api/v1/sets/:setNumber/acquisitions': { klein: true, antwort: AcquisitionsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/parts/:partNumber/:colorId/acquisitions': { klein: true, antwort: AcquisitionsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/minifigs/:figNumber/acquisitions': { klein: true, antwort: AcquisitionsResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'GET /api/v1/storage/locations': { klein: true, antwort: LagerortVorratResponse, abfrage: abfrage({ owner: LAGER_KONTEN,
    accounts: Q.konten.meta({ deprecated: true, description: 'wird nicht ausgewertet: Die Liste folgt dem Recht' }) }) },
  'GET /api/v1/storage': { klein: true, antwort: LagerorteResponse, abfrage: abfrage({ accounts: Q.konten }) },
  'PUT /api/v1/minifigs/:figNumber/storage': { eingabe: z.strictObject({ storage: TEXT().nullable().optional() }), antwort: LagerortResponse },
  'PUT /api/v1/sets/:setNumber/acquisitions/:acqId': { antwort: GenericResponse, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId': { eingabe: OHNE_RUMPF, antwort: GenericResponse },
  'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': { antwort: GenericResponse, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': { eingabe: OHNE_RUMPF, antwort: DeleteWithQuantityResponse },
  'PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId': { antwort: GenericResponse, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId': { eingabe: OHNE_RUMPF, antwort: DeleteWithQuantityResponse },
  'PUT /api/v1/sets/:setNumber/storage': { eingabe: z.strictObject({ storage: TEXT().nullable().optional() }), antwort: LagerortResponse },
  'PUT /api/v1/parts/:partNumber/:colorId/storage': { eingabe: z.strictObject({ storage: TEXT().nullable().optional() }), antwort: LagerortResponse },
  'POST /api/v1/storage/locations': { eingabe: z.strictObject({ name: TEXT().optional(), owner: KENNUNG.optional() }), antwort: LagerortEintragResponse,
    abfrage: abfrage({ owner: LAGER_KONTEN }) },
  'PUT /api/v1/storage/locations/:id': { eingabe: z.strictObject({ name: TEXT().optional(), owner: KENNUNG.optional() }), antwort: LagerortEintragResponse,
    abfrage: abfrage({ owner: LAGER_KONTEN }) },
  'DELETE /api/v1/storage/locations/:id': { eingabe: OHNE_RUMPF, antwort: LagerortResponse, abfrage: abfrage({ owner: LAGER_KONTEN }) },
  'PUT /api/v1/storage/default': { eingabe: z.strictObject({ id: KENNUNG.nullable().optional() }), antwort: LagerortVorgabeResponse },
  'GET /api/v1/papierkorb': { klein: true, antwort: Papierkorb },
  'POST /api/v1/papierkorb/:id/wiederherstellen': { eingabe: OHNE_RUMPF, antwort: Wiederhergestellt },
  'DELETE /api/v1/papierkorb/:id': { antwort: Erfolg, ...bestaetigt() },
  'DELETE /api/v1/papierkorb': { antwort: PapierkorbGeleert, ...bestaetigt() },
  'DELETE /api/v1/bestand': { antwort: BestandGeleert, ...bestaetigt() },
} satisfies Record<string, Route>;
