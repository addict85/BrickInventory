/** docs/openapi-v2.json and docs/openapi.json (v1) from the contract. Every named schema of an
 * area becomes a component; that way a set appears once in the file, not in every route. v1 is
 * the same contract through the v1 dictionary (v1.ts), so both documents cannot drift apart. */
import { z } from 'zod';
import { type Route, ErrorBody, ErrorCode, PATH } from './base';
import { AREAS } from './index';
import { API_VERSION, SUNSET_DAY } from './version';
import { v1SchemaName, V1_AREAS } from './v1Names';
import { v1Key } from './v1Routes';
import { toV1Schema, v1Field } from './v1';

export type ApiPath = 1 | 2;

const MIME: Record<NonNullable<Route['kind']>, string> = {
  pdf: 'application/pdf',
  file: 'application/octet-stream',
  stream: 'text/event-stream',
  csv: 'text/csv',
  zip: 'application/zip',
};
const URI = (id: string) => `#/components/schemas/${id}`;

/** All named schemas: export name → schema. A duplicate name is an error. */
export function namedSchemas(): Map<string, z.ZodType> {
  const from = new Map<string, z.ZodType>([
    ['ErrorBody', ErrorBody],
    ['ErrorCode', ErrorCode],
  ]);
  for (const [area, mod] of Object.entries(AREAS)) {
    for (const [name, value] of Object.entries(mod)) {
      if (!(value instanceof z.ZodType) || from.get(name) === value) continue;
      if (from.has(name)) throw new Error(`Schema ${name} gibt es zweimal (zuletzt in ${area})`);
      from.set(name, value);
    }
  }
  return from;
}

/** What differs between the two documents; v2 is the contract as written. */
interface Version {
  schema: <T extends z.ZodType | undefined>(s: T) => T;
  name: (schemaName: string) => string;
  key: (contractKey: string) => string;
  area: (area: string) => string;
  field: (name: string) => string;
  eventSuffix: string;
  errorSchema: string;
  x: { confirmation: string; password: string; secret: string; small: string };
}
const V2: Version = {
  schema: s => s,
  name: n => n,
  key: k => k,
  area: a => a,
  field: f => f,
  eventSuffix: '_event',
  errorSchema: 'ErrorBody',
  x: { confirmation: 'x-confirmation', password: 'password', secret: 'x-secret', small: 'x-small' },
};
const V1: Version = {
  schema: toV1Schema,
  name: v1SchemaName,
  key: v1Key,
  area: a => V1_AREAS[a] ?? a,
  field: f => v1Field(undefined, f),
  eventSuffix: '_ereignis',
  errorSchema: 'Fehler',
  x: { confirmation: 'x-bestaetigung', password: 'passwort', secret: 'x-geheim', small: 'x-klein' },
};

function components(v: Version) {
  const register = z.registry<{ id: string }>();
  const named = new Map<z.ZodType, string>();
  const take = (schema: z.ZodType | undefined, id: string) => {
    if (!schema || named.has(schema)) return;
    register.add(schema, { id });
    named.set(schema, id);
  };
  for (const [name, schema] of namedSchemas()) take(v.schema(schema), v.name(name));
  for (const mod of Object.values(AREAS))
    for (const [key, r] of Object.entries(mod.routes as Record<string, Route>)) {
      const id = v
        .key(key)
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+$/, '');
      take(v.schema(r.response), id);
      take(v.schema(r.event), `${id}${v.eventSuffix}`);
    }
  return { register, named };
}

function success(r: Route, v: Version, named: Map<z.ZodType, string>) {
  const ref = (s: z.ZodType) => ({ schema: { $ref: URI(named.get(v.schema(s)) ?? '') } });
  if (r.response) return { description: 'Success', content: { 'application/json': ref(r.response) } };
  return { description: 'Success', content: { [MIME[r.kind ?? 'file']]: r.event ? ref(r.event) : {} } };
}

function pathParameters(v2Path: string, path: string) {
  const v2Names = [...v2Path.matchAll(/:(\w+)/g)].map(m => m[1] ?? '');
  return [...path.matchAll(/:(\w+)/g)].map((m, i) => {
    const p = z.toJSONSchema((PATH as Record<string, z.ZodType>)[v2Names[i] ?? ''] ?? z.never(), {
      io: 'input',
      unrepresentable: 'any',
    });
    delete p.$schema;
    return { name: m[1], in: 'path', required: true, schema: p } as Record<string, unknown>;
  });
}

function queryParameters(r: Route, v: Version): Record<string, unknown>[] {
  const query = v.schema(r.query);
  if (!query) return [];
  const s = z.toJSONSchema(query, { io: 'input', unrepresentable: 'any' });
  const mandatory = new Set(s.required ?? []);
  return Object.entries(s.properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'query',
    required: mandatory.has(name),
    schema,
    ...((schema as { deprecated?: boolean }).deprecated ? { deprecated: true } : {}),
  }));
}

function requestBody(r: Route, v: Version): Record<string, unknown> | undefined {
  const input = v.schema(r.input);
  const body = input ? z.toJSONSchema(input, { io: 'input', unrepresentable: 'any' }) : undefined;
  delete body?.$schema;
  if (r.form)
    return {
      content: {
        'multipart/form-data': {
          schema: {
            ...body,
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' }, ...body?.properties },
          },
        },
      },
    };
  return body ? { content: { 'application/json': { schema: body } } } : undefined;
}

function operation(
  r: Route,
  v: Version,
  named: Map<z.ZodType, string>,
  tag: string,
  parameters: Record<string, unknown>[],
): Record<string, unknown> {
  const op: Record<string, unknown> = {
    tags: [tag],
    ...(parameters.length ? { parameters } : {}),
    responses: {
      200: success(r, v, named),
      default: { description: 'Error', content: { 'application/json': { schema: { $ref: URI(v.errorSchema) } } } },
    },
  };
  const body = requestBody(r, v);
  if (body) op.requestBody = body;
  if (r.confirmation)
    op[v.x.confirmation] = { [v.x.password]: v.field(r.confirmation.password), code: v.field(r.confirmation.code) };
  if (r.secret) op[v.x.secret] = true;
  if (r.small) op[v.x.small] = true;
  return op;
}

export function openapi(version: ApiPath = 1): Record<string, unknown> {
  const v = version === 1 ? V1 : V2;
  const { register, named } = components(v);
  const { schemas } = z.toJSONSchema(register, { uri: URI, unrepresentable: 'any' });
  for (const s of Object.values(schemas)) {
    delete s.$schema;
    delete s.$id;
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [area, mod] of Object.entries(AREAS)) {
    for (const [contractKey, r] of Object.entries(mod.routes as Record<string, Route>)) {
      const [method = '', path = ''] = v.key(contractKey).split(' ');
      const parameters = [...pathParameters(contractKey.split(' ')[1] ?? '', path), ...queryParameters(r, v)];
      const oaPath = path.replace(/:(\w+)/g, '{$1}');
      paths[oaPath] ??= {};
      paths[oaPath][method.toLowerCase()] = operation(r, v, named, v.area(area), parameters);
    }
  }
  const sorted = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: {
      title: 'BrickInventory API',
      version: String(API_VERSION),
      description:
        version === 1
          ? 'Generated from src/contract/ (npm run contract:openapi). Do not edit by hand.'
          : `API v2, generated from src/contract/ (npm run contract:openapi). Do not edit by hand. /api/v1 is a deprecated alias until ${SUNSET_DAY}.`,
    },
    paths: sorted(paths),
    components: { schemas: sorted(schemas) },
  };
}
