/** The fields we read from Rebrickable and Brickset responses. Open
 * (looseObject), because the services deliver more; we check what we use,
 * so a changed response shows up as an error instead of as empty fields. */
import { z } from 'zod';

const text = z.string().nullable().optional();
const number = z.number().nullable().optional();
const foreignNumbers = z.record(z.string(), z.unknown()).nullable().optional();

export const RbSet = z.looseObject({
  set_num: z.string(),
  name: text,
  year: number,
  theme_id: number,
  num_parts: number,
  set_img_url: text,
  external_ids: foreignNumbers,
});

export const RbThema = z.looseObject({ id: z.number(), name: text, parent_id: number });

export const RbTeil = z.looseObject({
  part_num: z.string(),
  name: text,
  part_img_url: text,
  part_cat_id: number,
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
  quantity: number,
  set_img_url: text,
});

export const RbMinifig = z.looseObject({ set_num: text, name: text, set_img_url: text });
export const RbColor = z.looseObject({ id: z.number(), name: text, rgb: text });
export const RbPartColor = z.looseObject({ part_img_url: text });

/** One page of a list; `next` is the address of the following one. */
export const rbPage = <T extends z.ZodType>(row: T) =>
  z.looseObject({ count: z.number().optional(), next: text, results: z.array(row) });

/** Every Brickset response; with `status: 'error'` the reason is in `message`. */
export const BsResponse = z.looseObject({ status: z.string(), message: text });

export const BsSet = z.looseObject({
  number: z.string(),
  numberVariant: z.number(),
  name: text,
  year: number,
  theme: text,
  pieces: number,
  minifigs: number,
  image: z.looseObject({ imageURL: text, thumbnailURL: text }).nullable().optional(),
});
export const BsSets = BsResponse.extend({ sets: z.array(BsSet).optional() });
export const BsInstructions = BsResponse.extend({
  instructions: z.array(z.looseObject({ URL: z.string(), description: text })).optional(),
});

/** Checks a response; an unexpected shape is an error with the first finding. */
export function checkResponse<T extends z.ZodType>(service: string, schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new Error(`${service}: unerwartete Antwort (${i?.path.join('.') || '$'}: ${i?.message ?? ''})`);
}
