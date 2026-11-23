/** Fields of a response that its contract does not name. Responses stay open
 * objects (a new field breaks no app); in tests, however, every field should be in the
 * contract, otherwise OpenAPI and the UI's types do not know it. */
import type { z } from 'zod';

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  catchall?: z.ZodType;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  left?: z.ZodType;
  right?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  getter?: () => z.ZodType;
  valueType?: z.ZodType;
  items?: z.ZodType[];
}

const defOf = (s: z.ZodType): Def => (s as unknown as { _zod: { def: Def } })._zod.def;
const SHELL = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional', 'success']);

type Walk = (s: z.ZodType | undefined, w: unknown, path: string) => void;
type Step = (d: Def, w: unknown, path: string, walk: Walk, found: (p: string) => void, limit: number) => void;

const eachItem =
  (schemaAt: (d: Def, i: number) => z.ZodType | undefined): Step =>
  (d, w, path, walk) => {
    if (Array.isArray(w))
      w.forEach((x, i) => {
        walk(schemaAt(d, i), x, `${path}${i}.`);
      });
  };

/** One step per schema kind; kinds without a step (scalars) have no fields. */
const STEPS: Record<string, Step> = {
  lazy: (d, w, path, walk) => walk(d.getter?.(), w, path),
  pipe: (d, w, path, walk) => walk(d.in, w, path),
  // Known together is what either of the two sides names.
  intersection: (d, w, path, _walk, found, limit) => {
    const right = new Set(unknownFields(d.right as z.ZodType, w, limit));
    for (const p of unknownFields(d.left as z.ZodType, w, limit)) if (right.has(p)) found(path + p);
  },
  union: (d, w, path, walk) =>
    walk(
      d.options?.find(o => o.safeParse(w).success),
      w,
      path,
    ),
  array: eachItem(d => d.element),
  tuple: eachItem((d, i) => d.items?.[i]),
  record: (d, w, path, walk) => {
    if (typeof w === 'object') for (const [k, x] of Object.entries(w as object)) walk(d.valueType, x, `${path}${k}.`);
  },
  object: (d, w, path, walk, found) => {
    if (typeof w !== 'object' || Array.isArray(w)) return;
    // looseObject has catchall unknown: open, but not described in the contract.
    const open = !d.catchall || defOf(d.catchall).type === 'unknown';
    for (const [k, x] of Object.entries(w as object)) {
      const field = d.shape?.[k];
      if (field) walk(field, x, `${path}${k}.`);
      else if (open) found(path + k);
      else walk(d.catchall, x, `${path}${k}.`);
    }
  },
};
for (const shell of SHELL) STEPS[shell] = (d, w, path, walk) => walk(d.innerType, w, path);

/** Paths like `sets.0.letzter_kauf`; at most `grenze` so that a long list does not flood. */
export function unknownFields(schema: z.ZodType, value: unknown, limit = 20): string[] {
  const findings = new Set<string>();
  const found = (p: string) => findings.add(p);
  const walk: Walk = (s, w, path) => {
    if (!s || w === null || w === undefined || findings.size >= limit) return;
    const d = defOf(s);
    STEPS[d.type]?.(d, w, path, walk, found, limit);
  };
  walk(schema, value, '');
  return [...findings];
}
