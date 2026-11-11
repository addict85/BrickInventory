/** Die Felder, die wir aus Rebrickable- und Brickset-Antworten lesen. Offen
 * (looseObject), weil die Dienste mehr liefern; geprüft wird, was wir benutzen,
 * damit eine geänderte Antwort als Fehler auffällt statt als leere Felder. */
import { z } from 'zod';

const text = z.string().nullable().optional();
const zahl = z.number().nullable().optional();
const fremdeNummern = z.record(z.string(), z.unknown()).nullable().optional();

export const RbSet = z.looseObject({
  set_num: z.string(),
  name: text,
  year: zahl,
  theme_id: zahl,
  num_parts: zahl,
  set_img_url: text,
  external_ids: fremdeNummern,
});

export const RbThema = z.looseObject({ id: z.number(), name: text, parent_id: zahl });

export const RbTeil = z.looseObject({
  part_num: z.string(),
  name: text,
  part_img_url: text,
  part_cat_id: zahl,
  external_ids: fremdeNummern,
});

export const RbSetTeil = z.looseObject({
  part: RbTeil,
  color: z.looseObject({ id: z.number(), name: text, rgb: text }),
  quantity: z.number(),
  is_spare: z.boolean().optional(),
});

export const RbSetFigur = z.looseObject({
  set_num: z.string(),
  set_name: text,
  quantity: zahl,
  set_img_url: text,
});

export const RbFigur = z.looseObject({ set_num: text, name: text, set_img_url: text });
export const RbFarbe = z.looseObject({ id: z.number(), name: text, rgb: text });
export const RbTeilFarbe = z.looseObject({ part_img_url: text });

/** Eine Seite einer Liste; `next` ist die Adresse der nächsten. */
export const rbSeite = <T extends z.ZodType>(zeile: T) =>
  z.looseObject({ count: z.number().optional(), next: text, results: z.array(zeile) });

/** Jede Brickset-Antwort; bei `status: 'error'` steht der Grund in `message`. */
export const BsAntwort = z.looseObject({ status: z.string(), message: text });

export const BsSet = z.looseObject({
  number: z.string(),
  numberVariant: z.number(),
  name: text,
  year: zahl,
  theme: text,
  pieces: zahl,
  minifigs: zahl,
  image: z.looseObject({ imageURL: text, thumbnailURL: text }).nullable().optional(),
});
export const BsSets = BsAntwort.extend({ sets: z.array(BsSet).optional() });
export const BsAnleitungen = BsAntwort.extend({
  instructions: z.array(z.looseObject({ URL: z.string(), description: text })).optional(),
});

/** Prüft eine Antwort; eine unerwartete Form ist ein Fehler mit dem ersten Befund. */
export function pruefeAntwort<T extends z.ZodType>(dienst: string, schema: T, daten: unknown): z.output<T> {
  const r = schema.safeParse(daten);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new Error(`${dienst}: unerwartete Antwort (${i?.path.join('.') || '$'}: ${i?.message ?? ''})`);
}
