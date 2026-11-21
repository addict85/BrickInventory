/**
 * Completes a test response from the zod schema of its route: required fields
 * the test does not need get the smallest valid value (0, '', false,
 * [], null). Fields outside the schema stay, because the contract
 * is open (looseObject) and the server sends such fields today too.
 */

/** @param {any} s */
const art = s => s._zod.def.type;

/**
 * @param {any} schema  zod schema
 * @param {any} wert    part from the test (may be missing)
 */
function fill(schema, wert) {
  const def = schema._zod.def;
  switch (art(schema)) {
    case 'optional':
      return wert === undefined ? undefined : fill(def.innerType, wert);
    case 'nullable':
      return wert == null ? null : fill(def.innerType, wert);
    case 'object': {
      if (wert !== undefined && (wert === null || typeof wert !== 'object' || Array.isArray(wert))) return wert;
      const quelle = wert ?? {};
      const aus = {};
      for (const [k, v] of Object.entries(quelle)) if (!Object.hasOwn(def.shape, k)) aus[k] = v;
      for (const [k, s] of Object.entries(def.shape)) {
        const v = fill(s, quelle[k]);
        if (v !== undefined) aus[k] = v;
      }
      return aus;
    }
    case 'array':
      return Array.isArray(wert) ? wert.map(x => fill(def.element, x)) : (wert ?? []);
    case 'record': {
      if (!wert || typeof wert !== 'object') return wert ?? {};
      return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, fill(def.valueType, v)]));
    }
    case 'union': {
      if (wert === undefined) return fill(def.options[0], undefined);
      // The first option that matches after completing.
      for (const o of def.options) {
        const v = fill(o, wert);
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

module.exports = { complete: fill };
