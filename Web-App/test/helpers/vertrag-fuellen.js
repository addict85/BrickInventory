/**
 * Ergänzt eine Testantwort aus dem zod-Schema ihrer Route: Pflichtfelder, die
 * der Test nicht braucht, bekommen den kleinsten gültigen Wert (0, '', false,
 * [], null). Felder ausserhalb des Schemas bleiben stehen, denn der Vertrag
 * ist offen (looseObject) und der Server sendet solche Felder heute auch.
 */

/** @param {any} s */
const art = s => s._zod.def.type;

/**
 * @param {any} schema  zod-Schema
 * @param {any} wert    Teil aus dem Test (darf fehlen)
 */
function fuelle(schema, wert) {
  const def = schema._zod.def;
  switch (art(schema)) {
    case 'optional':
      return wert === undefined ? undefined : fuelle(def.innerType, wert);
    case 'nullable':
      return wert == null ? null : fuelle(def.innerType, wert);
    case 'object': {
      if (wert !== undefined && (wert === null || typeof wert !== 'object' || Array.isArray(wert))) return wert;
      const quelle = wert ?? {};
      const aus = {};
      for (const [k, v] of Object.entries(quelle)) if (!Object.hasOwn(def.shape, k)) aus[k] = v;
      for (const [k, s] of Object.entries(def.shape)) {
        const v = fuelle(s, quelle[k]);
        if (v !== undefined) aus[k] = v;
      }
      return aus;
    }
    case 'array':
      return Array.isArray(wert) ? wert.map(x => fuelle(def.element, x)) : (wert ?? []);
    case 'record': {
      if (!wert || typeof wert !== 'object') return wert ?? {};
      return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, fuelle(def.valueType, v)]));
    }
    case 'union': {
      if (wert === undefined) return fuelle(def.options[0], undefined);
      // Die erste Möglichkeit, die nach dem Ergänzen passt.
      for (const o of def.options) {
        const v = fuelle(o, wert);
        if (o.safeParse(v).success) return v;
      }
      return wert;
    }
    case 'string':
      return wert ?? '';
    case 'number':
      return wert ?? 0;
    case 'boolean':
      return wert ?? false;
    case 'literal':
      return wert ?? def.values[0];
    case 'enum':
      return wert ?? Object.values(def.entries)[0];
    default:
      return wert;
  }
}

module.exports = { vervollstaendige: fuelle };
