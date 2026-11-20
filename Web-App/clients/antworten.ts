/** Die Felder, die wir aus Rebrickable- und Brickset-Antworten lesen. Offen
 * (looseObject), weil die Dienste mehr liefern; geprüft wird, was wir benutzen,
 * damit eine geänderte Antwort als Fehler auffällt statt als leere Felder. */
import { z } from 'zod';

const text = z.string().nullable().optional();
const zahl = z.number().nullable().optional();
const foreignNumbers = z.record(z.string(), z.unknown()).nullable().optional();

export const RbSet = z.looseObject({
  set_num: z.string(),
  name: text,
  year: zahl,
  theme_id: zahl,
  num_parts: zahl,
  set_img_url: text,
  external_ids: foreignNumbers,
});

export const RbThema = z.looseObject({ id: z.number(), name: text, parent_id: zahl });

export const RbTeil = z.looseObject({
  part_num: z.string(),
  name: text,
  part_img_url: text,
  part_cat_id: zahl,
  external_ids: foreignNumbers,
});

export const RbSetTeil = z.looseObject({
  part: RbTeil,
  color: z.looseObject({ id: z.number(), name: text, rgb: text }),
  quantity: z.number(),
  is_spare: z.boolean().optional(),
});

export const RbSetMinifig = z.looseObject({
  set_num: z.string(),
  set_name: text,
  quantity: zahl,
  set_img_url: text,
});

export const RbMinifig = z.looseObject({ set_num: text, name: text, set_img_url: text });
export const RbColor = z.looseObject({ id: z.number(), name: text, rgb: text });
export const RbPartColor = z.looseObject({ part_img_url: text });

/** Eine Seite einer Liste; `next` ist die Adresse der nächsten. */
export const rbPage = <T extends z.ZodType>(zeile: T) =>
  z.looseObject({ count: z.number().optional(), next: text, results: z.array(zeile) });

/** Jede Brickset-Antwort; bei `status: 'error'` steht der Grund in `message`. */
export const BsResponse = z.looseObject({ status: z.string(), message: text });

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
export const BsSets = BsResponse.extend({ sets: z.array(BsSet).optional() });
export const BsInstructions = BsResponse.extend({
  instructions: z.array(z.looseObject({ URL: z.string(), description: text })).optional(),
});

/** Prüft eine Antwort; eine unerwartete Form ist ein Fehler mit dem ersten Befund. */
export function checkResponse<T extends z.ZodType>(dienst: string, schema: T, daten: unknown): z.output<T> {
  const r = schema.safeParse(daten);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new Error(`${dienst}: unerwartete Antwort (${i?.path.join('.') || '$'}: ${i?.message ?? ''})`);
}
