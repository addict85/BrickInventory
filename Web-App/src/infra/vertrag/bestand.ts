import { z } from 'zod';
import { eingabe } from '../validate';
import { type Route, zeit, Erfolg, ganz, bestaetigt } from './grund';
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
});

export const AcquisitionTotals = z.looseObject({
  quantity: z.number().int(),
  amount: z.number().nullable().optional(),
  priced_rows: z.number().int(),
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

/** Nur die Menge prüft validate.ts; Preis, Datum und Zustand prüft die Erfassung selbst. */
const Erfassungsaenderung = z.looseObject({ quantity: eingabe.menge(1, 100_000, false) });

export const routen = {
  'GET /api/v1/sets/:setNumber/acquisitions': { antwort: AcquisitionsResponse },
  'GET /api/v1/parts/:partNumber/:colorId/acquisitions': { antwort: AcquisitionsResponse },
  'GET /api/v1/minifigs/:figNumber/acquisitions': { antwort: AcquisitionsResponse },
  'GET /api/v1/storage/locations': { antwort: LagerortVorratResponse },
  'GET /api/v1/storage': { antwort: LagerorteResponse },
  'PUT /api/v1/minifigs/:figNumber/storage': { antwort: LagerortResponse },
  'PUT /api/v1/sets/:setNumber/acquisitions/:acqId': { antwort: GenericResponse, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId': { antwort: GenericResponse },
  'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': { antwort: GenericResponse, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': { antwort: DeleteWithQuantityResponse },
  'PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId': { antwort: GenericResponse, eingabe: Erfassungsaenderung },
  'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId': { antwort: DeleteWithQuantityResponse },
  'PUT /api/v1/sets/:setNumber/storage': { antwort: LagerortResponse },
  'PUT /api/v1/parts/:partNumber/:colorId/storage': { antwort: LagerortResponse },
  'POST /api/v1/storage/locations': { antwort: LagerortEintragResponse },
  'PUT /api/v1/storage/locations/:id': { antwort: LagerortEintragResponse },
  'DELETE /api/v1/storage/locations/:id': { antwort: LagerortResponse },
  'PUT /api/v1/storage/default': { antwort: LagerortVorgabeResponse },
  'GET /api/v1/papierkorb': { antwort: Papierkorb },
  'POST /api/v1/papierkorb/:id/wiederherstellen': { antwort: Wiederhergestellt },
  'DELETE /api/v1/papierkorb/:id': { antwort: Erfolg, ...bestaetigt() },
  'DELETE /api/v1/papierkorb': { antwort: PapierkorbGeleert, ...bestaetigt() },
  'DELETE /api/v1/bestand': { antwort: BestandGeleert, ...bestaetigt() },
} satisfies Record<string, Route>;
