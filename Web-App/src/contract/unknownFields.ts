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
export function unbekannteFelder(schema: z.ZodType, wert: unknown, grenze = 20): string[] {
  const funde = new Set<string>();
  const lauf = (s: z.ZodType | undefined, w: unknown, pfad: string): void => {
    if (!s || w === null || w === undefined || funde.size >= grenze) return;
    const d = defOf(s);
    if (SHELL.has(d.type)) {
      lauf(d.innerType, w, pfad);
      return;
    }
    if (d.type === 'lazy') {
      lauf(d.getter?.(), w, pfad);
      return;
    }
    if (d.type === 'pipe') {
      lauf(d.in, w, pfad);
      return;
    }
    if (d.type === 'intersection') {
      // Known together is what either of the two sides names.
      const links = unbekannteFelder(d.left as z.ZodType, w, grenze);
      const rechts = new Set(unbekannteFelder(d.right as z.ZodType, w, grenze));
      for (const p of links) if (rechts.has(p)) funde.add(pfad + p);
      return;
    }
    if (d.type === 'union') {
      const passt = d.options?.find(o => o.safeParse(w).success);
      lauf(passt, w, pfad);
      return;
    }
    if (d.type === 'array' && Array.isArray(w)) {
      w.forEach((x, i) => {
        lauf(d.element, x, `${pfad}${i}.`);
      });
      return;
    }
    if (d.type === 'tuple' && Array.isArray(w)) {
      w.forEach((x, i) => {
        lauf(d.items?.[i], x, `${pfad}${i}.`);
      });
      return;
    }
    if (d.type === 'record' && typeof w === 'object') {
      for (const [k, x] of Object.entries(w as object)) lauf(d.valueType, x, `${pfad}${k}.`);
      return;
    }
    if (d.type !== 'object' || typeof w !== 'object' || Array.isArray(w)) return;
    // looseObject has catchall unknown: open, but not described in the contract.
    const offen = !d.catchall || defOf(d.catchall).type === 'unknown';
    for (const [k, x] of Object.entries(w as object)) {
      const feld = d.shape?.[k];
      if (feld) lauf(feld, x, `${pfad}${k}.`);
      else if (offen) funde.add(pfad + k);
      else lauf(d.catchall, x, `${pfad}${k}.`);
    }
  };
  lauf(schema, wert, '');
  return [...funde];
}
