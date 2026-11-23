'use strict';
/**
 * A sample input for a zod schema of the contract: `wert(name)` gives a value for a field
 * by name (the victim's identifiers, the own password), everything else gets the smallest
 * value of its type. With `alle` optional fields are filled too.
 */

/** A sample value for a zod schema; `name` is the field name, `value` delivers the victim's values. */
function sample(schema, name, value, all) {
  const d = schema?._zod?.def;
  if (!d) return undefined;
  if (name && value(name) !== undefined) return value(name);
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
      return sample(d.innerType, name, value, all);
    case 'pipe':
      return sample(d.in, name, value, all);
    case 'union':
      for (const o of d.options) {
        const v = sample(o, name, value, all);
        if (v !== undefined) return v;
      }
      return undefined;
    case 'enum':
      return Object.values(d.entries)[0];
    case 'literal':
      return d.values[0];
    case 'string':
      return 'x';
    case 'number':
    case 'int':
      return 1;
    case 'boolean':
      return true;
    case 'array': {
      const e = sample(d.element, null, value, all);
      return e === undefined ? [] : [e];
    }
    case 'record':
      return {};
    case 'object': {
      const out = {};
      for (const [k, s] of Object.entries(d.shape)) {
        const optional = ['optional', 'default', 'prefault'].includes(s?._zod?.def?.type);
        if (optional && !all && value(k) === undefined) continue;
        const v = sample(s, k, value, all);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/**
 * @param {any} schema
 * @param {(name: string) => unknown} value
 * @param {boolean} [all]
 */
const example = (schema, value, all = false) => sample(schema, null, value, all);

module.exports = { example };
