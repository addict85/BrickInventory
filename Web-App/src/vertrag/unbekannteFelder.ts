/** Felder einer Antwort, die ihr Vertrag nicht nennt. Antworten bleiben offene
 * Objekte (ein neues Feld bricht keine App); in Tests soll aber jedes Feld im
 * Vertrag stehen, sonst kennen OpenAPI und die Typen der Oberfläche es nicht. */
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

const defVon = (s: z.ZodType): Def => (s as unknown as { _zod: { def: Def } })._zod.def;
const HUELLE = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional', 'success']);

/** Pfade wie `sets.0.letzter_kauf`; höchstens `grenze`, damit eine lange Liste nicht flutet. */
export function unbekannteFelder(schema: z.ZodType, wert: unknown, grenze = 20): string[] {
  const funde = new Set<string>();
  const lauf = (s: z.ZodType | undefined, w: unknown, pfad: string): void => {
    if (!s || w === null || w === undefined || funde.size >= grenze) return;
    const d = defVon(s);
    if (HUELLE.has(d.type)) return lauf(d.innerType, w, pfad);
    if (d.type === 'lazy') return lauf(d.getter?.(), w, pfad);
    if (d.type === 'pipe') return lauf(d.in, w, pfad);
    if (d.type === 'intersection') {
      // Zusammen bekannt ist, was eine der beiden Seiten nennt.
      const links = unbekannteFelder(d.left as z.ZodType, w, grenze);
      const rechts = new Set(unbekannteFelder(d.right as z.ZodType, w, grenze));
      for (const p of links) if (rechts.has(p)) funde.add(pfad + p);
      return;
    }
    if (d.type === 'union') {
      const passt = d.options?.find(o => o.safeParse(w).success);
      return lauf(passt, w, pfad);
    }
    if (d.type === 'array' && Array.isArray(w)) {
      w.forEach((x, i) => lauf(d.element, x, `${pfad}${i}.`));
      return;
    }
    if (d.type === 'tuple' && Array.isArray(w)) {
      w.forEach((x, i) => lauf(d.items?.[i], x, `${pfad}${i}.`));
      return;
    }
    if (d.type === 'record' && typeof w === 'object') {
      for (const [k, x] of Object.entries(w as object)) lauf(d.valueType, x, `${pfad}${k}.`);
      return;
    }
    if (d.type !== 'object' || typeof w !== 'object' || Array.isArray(w)) return;
    // looseObject hat catchall unknown: offen, aber im Vertrag nicht beschrieben.
    const offen = !d.catchall || defVon(d.catchall).type === 'unknown';
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
