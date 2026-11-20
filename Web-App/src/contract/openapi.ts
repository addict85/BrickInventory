/** docs/openapi.json from the contract. Every named schema of an area becomes
 * a component; that way a set appears once in the file, not in every route. */
import { z } from 'zod';
import { type Route, Fehler, Fehlercode, PATH } from './base';
import { AREAS } from './index';
import { API_VERSION } from './version';

const MIME: Record<NonNullable<Route['art']>, string> = {
  pdf: 'application/pdf',
  datei: 'application/octet-stream',
  strom: 'text/event-stream',
  csv: 'text/csv',
  zip: 'application/zip',
};
const URI = (id: string) => `#/components/schemas/${id}`;

/** All named schemas: export name → schema. A duplicate name is an error. */
export function namedSchemas(): Map<string, z.ZodType> {
  const aus = new Map<string, z.ZodType>([
    ['Fehler', Fehler],
    ['Fehlercode', Fehlercode],
  ]);
  for (const [bereich, modul] of Object.entries(AREAS)) {
    for (const [name, wert] of Object.entries(modul)) {
      if (!(wert instanceof z.ZodType) || aus.get(name) === wert) continue;
      if (aus.has(name)) throw new Error(`Schema ${name} gibt es zweimal (zuletzt in ${bereich})`);
      aus.set(name, wert);
    }
  }
  return aus;
}

function komponenten() {
  const register = z.registry<{ id: string }>();
  const benannt = new Map<z.ZodType, string>();
  const nimm = (schema: z.ZodType | undefined, id: string) => {
    if (!schema || benannt.has(schema)) return;
    register.add(schema, { id });
    benannt.set(schema, id);
  };
  for (const [name, schema] of namedSchemas()) nimm(schema, name);
  for (const modul of Object.values(AREAS))
    for (const [schluessel, r] of Object.entries(modul.routen as Record<string, Route>)) {
      const id = schluessel.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '');
      nimm(r.antwort, id);
      nimm(r.ereignis, `${id}_ereignis`);
    }
  return { register, benannt };
}

function erfolg(r: Route, benannt: Map<z.ZodType, string>) {
  const ref = (s: z.ZodType) => ({ schema: { $ref: URI(benannt.get(s) ?? '') } });
  if (r.antwort) return { description: 'Erfolg', content: { 'application/json': ref(r.antwort) } };
  return { description: 'Erfolg', content: { [MIME[r.art ?? 'datei']]: r.ereignis ? ref(r.ereignis) : {} } };
}

export function openapi(): Record<string, unknown> {
  const { register, benannt } = komponenten();
  const { schemas } = z.toJSONSchema(register, { uri: URI, unrepresentable: 'any' });
  for (const s of Object.values(schemas)) {
    delete s.$schema;
    delete s.$id;
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [bereich, modul] of Object.entries(AREAS)) {
    for (const [schluessel, r] of Object.entries(modul.routen as Record<string, Route>)) {
      const [methode = '', pfad = ''] = schluessel.split(' ');
      const parameters: Record<string, unknown>[] = [...pfad.matchAll(/:(\w+)/g)].map(m => {
        const p = z.toJSONSchema((PATH as Record<string, z.ZodType>)[m[1] ?? ''] ?? z.never(), {
          io: 'input',
          unrepresentable: 'any',
        });
        delete p.$schema;
        return { name: m[1], in: 'path', required: true, schema: p };
      });
      if (r.abfrage) {
        const s = z.toJSONSchema(r.abfrage, { io: 'input', unrepresentable: 'any' });
        const pflicht = new Set(s.required ?? []);
        for (const [name, schema] of Object.entries(s.properties ?? {}))
          parameters.push({
            name,
            in: 'query',
            required: pflicht.has(name),
            schema,
            ...((schema as { deprecated?: boolean }).deprecated ? { deprecated: true } : {}),
          });
      }
      const ok = erfolg(r, benannt);
      const op: Record<string, unknown> = {
        tags: [bereich],
        ...(parameters.length ? { parameters } : {}),
        responses: {
          200: ok,
          default: { description: 'Fehler', content: { 'application/json': { schema: { $ref: URI('Fehler') } } } },
        },
      };
      const rumpf = r.eingabe ? z.toJSONSchema(r.eingabe, { io: 'input', unrepresentable: 'any' }) : undefined;
      delete rumpf?.$schema;
      if (r.formular)
        op.requestBody = {
          content: {
            'multipart/form-data': {
              schema: {
                ...rumpf,
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' }, ...rumpf?.properties },
              },
            },
          },
        };
      else if (rumpf) op.requestBody = { content: { 'application/json': { schema: rumpf } } };
      if (r.bestaetigung) op['x-bestaetigung'] = r.bestaetigung;
      if (r.geheim) op['x-geheim'] = true;
      if (r.klein) op['x-klein'] = true;
      const oaPath = pfad.replace(/:(\w+)/g, '{$1}');
      paths[oaPath] ??= {};
      paths[oaPath][methode.toLowerCase()] = op;
    }
  }
  const sortiert = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: {
      title: 'BrickInventory API',
      version: String(API_VERSION),
      description: 'Erzeugt aus src/contract/ (npm run vertrag:openapi). Nicht von Hand ändern.',
    },
    paths: sortiert(paths),
    components: { schemas: sortiert(schemas) },
  };
}
