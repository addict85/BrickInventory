/**
 * Completes a test response from the zod schema of its route: required fields
 * the test does not need get the smallest valid value (0, '', false,
 * [], null). Fields outside the schema stay, because the contract
 * is open (looseObject) and the server sends such fields today too.
 */

/** @param {any} s */
const kind = s => s._zod.def.type;

/**
 * @param {any} schema  zod schema
 * @param {any} value    part from the test (may be missing)
 */
function fill(schema, value) {
  const def = schema._zod.def;
  switch (kind(schema)) {
    case 'optional':
      return value === undefined ? undefined : fill(def.innerType, value);
    case 'nullable':
      return value == null ? null : fill(def.innerType, value);
    case 'object': {
      if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) return value;
      const source = value ?? {};
      const out = {};
      for (const [k, v] of Object.entries(source)) if (!Object.hasOwn(def.shape, k)) out[k] = v;
      for (const [k, s] of Object.entries(def.shape)) {
        const v = fill(s, source[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case 'array':
      return Array.isArray(value) ? value.map(x => fill(def.element, x)) : (value ?? []);
    case 'record': {
      if (!value || typeof value !== 'object') return value ?? {};
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(def.valueType, v)]));
    }
    case 'union': {
      if (value === undefined) return fill(def.options[0], undefined);
      // The first option that matches after completing.
      for (const o of def.options) {
        const v = fill(o, value);
        if (o.safeParse(v).success) return v;
      }
      return value;
    }
    case 'string':
      return value ?? '';
    case 'number':
      return value ?? 0;
    case 'boolean':
      return value ?? false;
    case 'literal':
      return value ?? def.values[0];
    case 'enum':
      return value ?? Object.values(def.entries)[0];
    default:
      return value;
  }
}

module.exports = { complete: fill };
