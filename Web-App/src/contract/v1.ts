/** API v1 from the v2 contract: the same schemas with the old field names and values. Used three
 * ways — v1 documents (openapi.ts), v1 responses (toV1) and v1 requests (toV2); one dictionary
 * (v1Names.ts) serves all three, so the alias cannot drift from its documentation. */
import { z } from 'zod';
import { V1_FIELDS, V1_ERROR_CODES } from './v1Names';
import { processWide } from '../infra/processWide';

type Def = Record<string, unknown> & { type: string };
type Map = Readonly<Record<string, string>>;

/** Like zod's own registry, keyed by the schema objects of the contract. */
const R = processWide('v1Namen', () => ({
  keys: new WeakMap<z.ZodType, Map>(),
  values: new WeakMap<z.ZodType, Map>(),
  insteadOf: new WeakMap<z.ZodType, string>(),
  converted: new WeakMap<z.ZodType, z.ZodType>(),
}));
const KEYS = R.keys;
const VALUES = R.values;
const INSTEAD_OF = R.insteadOf;

/** Field names of this object that differ in v1 although the v2 name also exists unchanged elsewhere. */
export function v1Keys<T extends z.ZodType>(schema: T, names: Map): T {
  KEYS.set(schema, names);
  return schema;
}
/** Values of this enum or text field that read differently in v1 (v2 value → v1 value). */
export function v1Values<T extends z.ZodType>(schema: T, values: Map): T {
  VALUES.set(schema, values);
  return schema;
}
/** A deprecated field whose description names its successor: the name follows the version. */
export function successorOf<T extends z.ZodType>(schema: T, field: string): T {
  INSTEAD_OF.set(schema, field);
  return schema;
}
export const insteadOf = (schema: z.ZodType): string | undefined => INSTEAD_OF.get(schema);

export const v1Field = (object: z.ZodType | undefined, key: string): string =>
  (object && KEYS.get(object)?.[key]) ?? V1_FIELDS[key] ?? key;
export const v1ErrorCode = (code: string): string => V1_ERROR_CODES[code] ?? code;

const def = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;
const CHILDREN = ['innerType', 'element', 'keyType', 'valueType', 'in', 'out', 'left', 'right', 'catchall', 'rest'];

/** The v1 twin of a schema; unchanged parts stay the same object (components keep their identity). */
const converted = R.converted;
export function toV1Schema<T extends z.ZodType | undefined>(schema: T): T {
  if (!schema) return schema;
  const done = converted.get(schema);
  if (done) return done as T;
  const d = def(schema);
  const next: Def = { ...d };
  let changed = false;
  const sub = (s: unknown) => {
    if (!(s instanceof z.ZodType)) return s;
    const t = toV1Schema(s);
    if (t !== s) changed = true;
    return t;
  };
  for (const c of CHILDREN) if (c in d) next[c] = sub(d[c]);
  if (d.type === 'object') {
    const shape: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.shape as Record<string, z.ZodType>)) {
      const name = v1Field(schema, k);
      if (name !== k) changed = true;
      shape[name] = sub(v);
    }
    next.shape = shape;
  } else if (Array.isArray(d.options)) next.options = d.options.map(sub);
  else if (Array.isArray(d.items)) next.items = d.items.map(sub);
  if (d.type === 'enum' && VALUES.has(schema)) {
    const map = VALUES.get(schema) as Map;
    next.entries = Object.fromEntries(Object.values(d.entries as Map).map(v => [map[v] ?? v, map[v] ?? v]));
    changed = true;
  }
  if (d.type === 'literal' && VALUES.has(schema)) {
    const map = VALUES.get(schema) as Map;
    next.values = (d.values as unknown[]).map(v => (typeof v === 'string' ? (map[v] ?? v) : v));
    changed = true;
  }
  const meta = z.globalRegistry.get(schema);
  const successor = INSTEAD_OF.get(schema);
  if (successor && meta?.description) changed = true;
  if (!changed) {
    converted.set(schema, schema);
    return schema;
  }
  const twin = (schema as unknown as { clone(d: Def): z.ZodType }).clone(next);
  if (meta) {
    const m = { ...meta };
    delete m.id;
    if (successor && m.description) m.description = m.description.replace(successor, v1Field(undefined, successor));
    z.globalRegistry.add(twin, m);
  }
  converted.set(schema, twin);
  return twin as T;
}

type Direction = 'v1' | 'v2';
const unwrap = (s: z.ZodType): z.ZodType => {
  const d = def(s);
  if (d.type === 'lazy') return unwrap((d.getter as () => z.ZodType)());
  if (d.type === 'pipe') return unwrap(d.in as z.ZodType);
  if (d.innerType instanceof z.ZodType) return unwrap(d.innerType);
  return s;
};

/** A comma list (`?status=offen,laeuft`) is mapped per item. */
function mapValue(s: z.ZodType, value: string, to: Direction): string {
  const map = VALUES.get(s);
  if (!map) return value;
  const one = (v: string) => {
    if (to === 'v1') return map[v] ?? v;
    for (const [v2, v1] of Object.entries(map)) if (v1 === v) return v2;
    return v;
  };
  return value.includes(',') ? value.split(',').map(one).join(',') : one(value);
}

/** A value along its schema into the other version: field names and enum values, nothing else. */
export function translate(schema: z.ZodType | undefined, value: unknown, to: Direction): unknown {
  if (!schema || value === null || value === undefined) return value;
  const s = unwrap(schema);
  const d = def(s);
  if (typeof value === 'string') {
    if (d.type === 'union') {
      for (const o of d.options as z.ZodType[]) {
        const m = mapValue(unwrap(o), value, to);
        if (m !== value) return m;
      }
      return value;
    }
    return mapValue(s, value, to);
  }
  if (Array.isArray(value)) {
    const element = d.type === 'array' ? (d.element as z.ZodType) : arrayOption(d);
    return element ? value.map(v => translate(element, v, to)) : value;
  }
  if (typeof value !== 'object') return value;
  if (d.type === 'record') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = translate(d.valueType as z.ZodType, v, to);
    return out;
  }
  const objects = d.type === 'object' ? [s] : objectOptions(d);
  if (!objects.length) return value;
  const fields = new Map<string, [string, z.ZodType]>();
  for (const o of objects)
    for (const [k, v] of Object.entries(def(o).shape as Record<string, z.ZodType>)) {
      const from = to === 'v1' ? k : v1Field(o, k);
      if (!fields.has(from)) fields.set(from, [to === 'v1' ? v1Field(o, k) : k, v]);
    }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const f = fields.get(k);
    if (f) out[f[0]] = translate(f[1], v, to);
    else out[k] = v;
  }
  return out;
}

function objectOptions(d: Def, out: z.ZodType[] = []): z.ZodType[] {
  const parts = d.type === 'union' ? (d.options as z.ZodType[]) : d.type === 'intersection' ? [d.left, d.right] : [];
  for (const p of parts as z.ZodType[]) {
    const u = unwrap(p);
    if (def(u).type === 'object') out.push(u);
    else objectOptions(def(u), out);
  }
  return out;
}

function arrayOption(d: Def): z.ZodType | undefined {
  if (d.type !== 'union') return undefined;
  for (const o of d.options as z.ZodType[]) {
    const od = def(unwrap(o));
    if (od.type === 'array') return od.element as z.ZodType;
  }
  return undefined;
}

/** An error body for v1: the code and the extra fields under their old names. */
export function errorToV1(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'code' && typeof v === 'string') out.code = v1ErrorCode(v);
    else if (k === 'field' && typeof v === 'string') out[v1Field(undefined, k)] = fieldPathToV1(v);
    else out[v1Field(undefined, k)] = v;
  }
  return out;
}
const fieldPathToV1 = (p: string) =>
  p
    .split('.')
    .map(s => v1Field(undefined, s))
    .join('.');
