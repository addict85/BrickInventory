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

/** Paths like `sets.0.letzter_kauf`; at most `grenze` so that a long list does not flood. */
export function unknownFields(schema: z.ZodType, wert: unknown, limit = 20): string[] {
  const findings = new Set<string>();
  const lauf = (s: z.ZodType | undefined, w: unknown, path: string): void => {
    if (!s || w === null || w === undefined || findings.size >= limit) return;
    const d = defOf(s);
    if (SHELL.has(d.type)) {
      lauf(d.innerType, w, path);
      return;
    }
    if (d.type === 'lazy') {
      lauf(d.getter?.(), w, path);
      return;
    }
    if (d.type === 'pipe') {
      lauf(d.in, w, path);
      return;
    }
    if (d.type === 'intersection') {
      // Known together is what either of the two sides names.
      const links = unknownFields(d.left as z.ZodType, w, limit);
      const right = new Set(unknownFields(d.right as z.ZodType, w, limit));
      for (const p of links) if (right.has(p)) findings.add(path + p);
      return;
    }
    if (d.type === 'union') {
      const fits = d.options?.find(o => o.safeParse(w).success);
      lauf(fits, w, path);
      return;
    }
    if (d.type === 'array' && Array.isArray(w)) {
      w.forEach((x, i) => {
        lauf(d.element, x, `${path}${i}.`);
      });
      return;
    }
    if (d.type === 'tuple' && Array.isArray(w)) {
      w.forEach((x, i) => {
        lauf(d.items?.[i], x, `${path}${i}.`);
      });
      return;
    }
    if (d.type === 'record' && typeof w === 'object') {
      for (const [k, x] of Object.entries(w as object)) lauf(d.valueType, x, `${path}${k}.`);
      return;
    }
    if (d.type !== 'object' || typeof w !== 'object' || Array.isArray(w)) return;
    // looseObject has catchall unknown: open, but not described in the contract.
    const open = !d.catchall || defOf(d.catchall).type === 'unknown';
    for (const [k, x] of Object.entries(w as object)) {
      const field = d.shape?.[k];
      if (field) lauf(field, x, `${path}${k}.`);
      else if (open) findings.add(path + k);
      else lauf(d.catchall, x, `${path}${k}.`);
    }
  };
  lauf(schema, wert, '');
  return [...findings];
}
