'use strict';
/**
 * A sample input for a zod schema of the contract: `wert(name)` gives a value for a field
 * by name (the victim's identifiers, the own password), everything else gets the smallest
 * value of its type. With `alle` optional fields are filled too.
 */

/** A sample value for a zod schema; `name` is the field name, `wert` delivers the victim's values. */
function beispiel(schema, name, wert, alle) {
  const d = schema?._zod?.def;
  if (!d) return undefined;
  if (name && wert(name) !== undefined) return wert(name);
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
      return beispiel(d.innerType, name, wert, alle);
    case 'pipe':
      return beispiel(d.in, name, wert, alle);
    case 'union':
      for (const o of d.options) {
        const v = beispiel(o, name, wert, alle);
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
      const e = beispiel(d.element, null, wert, alle);
      return e === undefined ? [] : [e];
    }
    case 'record':
      return {};
    case 'object': {
      const aus = {};
      for (const [k, s] of Object.entries(d.shape)) {
        const optional = ['optional', 'default', 'prefault'].includes(s?._zod?.def?.type);
        if (optional && !alle && wert(k) === undefined) continue;
        const v = beispiel(s, k, wert, alle);
        if (v !== undefined) aus[k] = v;
      }
      return aus;
    }
    default:
      return undefined;
  }
}

/**
 * @param {any} schema
 * @param {(name: string) => unknown} wert
 * @param {boolean} [alle]
 */
const example = (schema, wert, alle = false) => beispiel(schema, null, wert, alle);

module.exports = { example };
