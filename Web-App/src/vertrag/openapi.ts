/** docs/openapi.json aus dem Vertrag. Jedes benannte Schema eines Bereichs wird
 * eine Komponente; so steht ein Set einmal in der Datei, nicht in jeder Route. */
import { z } from 'zod';
import type { Route } from './grund';
import { Fehler, Fehlercode, PFAD } from './grund';
import { BEREICHE } from './index';
import { API_VERSION } from './version';

const MIME: Record<NonNullable<Route['art']>, string> = {
  pdf: 'application/pdf', datei: 'application/octet-stream', strom: 'text/event-stream',
  csv: 'text/csv', zip: 'application/zip',
};
const URI = (id: string) => `#/components/schemas/${id}`;

/** Alle benannten Schemas: Name des Exports → Schema. Ein Name doppelt ist ein Fehler. */
export function benannteSchemas(): Map<string, z.ZodType> {
  const aus = new Map<string, z.ZodType>([['Fehler', Fehler], ['Fehlercode', Fehlercode]]);
  for (const [bereich, modul] of Object.entries(BEREICHE)) {
    for (const [name, wert] of Object.entries(modul)) {
      if (!(wert instanceof z.ZodType) || aus.get(name) === wert) continue;
      if (aus.has(name)) throw new Error(`Schema ${name} gibt es zweimal (zuletzt in ${bereich})`);
      aus.set(name, wert);
    }
  }
  return aus;
}

export function openapi(): Record<string, unknown> {
  const register = z.registry<{ id: string }>();
  const benannt = new Map<z.ZodType, string>();
  for (const [name, schema] of benannteSchemas()) { register.add(schema, { id: name }); benannt.set(schema, name); }
  for (const modul of Object.values(BEREICHE)) {
    for (const [schluessel, r] of Object.entries(modul.routen as Record<string, Route>)) {
      if (r.antwort && !benannt.has(r.antwort)) {
        const id = schluessel.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '');
        register.add(r.antwort, { id }); benannt.set(r.antwort, id);
      }
    }
  }
  const { schemas } = z.toJSONSchema(register, { uri: URI, unrepresentable: 'any' });
  for (const s of Object.values(schemas)) { delete s.$schema; delete s.$id; }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [bereich, modul] of Object.entries(BEREICHE)) {
    for (const [schluessel, r] of Object.entries(modul.routen as Record<string, Route>)) {
      const [methode = '', pfad = ''] = schluessel.split(' ');
      const parameters: Record<string, unknown>[] = [...pfad.matchAll(/:(\w+)/g)].map(m => {
        const p = z.toJSONSchema((PFAD as Record<string, z.ZodType>)[m[1] ?? ''] ?? z.never(), { io: 'input', unrepresentable: 'any' });
        delete p.$schema;
        return { name: m[1], in: 'path', required: true, schema: p };
      });
      if (r.abfrage) {
        const s = z.toJSONSchema(r.abfrage, { io: 'input', unrepresentable: 'any' });
        const pflicht = new Set(s.required ?? []);
        for (const [name, schema] of Object.entries(s.properties ?? {}))
          parameters.push({ name, in: 'query', required: pflicht.has(name), schema,
            ...((schema as { deprecated?: boolean }).deprecated ? { deprecated: true } : {}) });
      }
      const ok = r.antwort
        ? { description: 'Erfolg', content: { 'application/json': { schema: { $ref: URI(benannt.get(r.antwort) ?? '') } } } }
        : { description: 'Erfolg', content: { [MIME[r.art ?? 'datei']]: {} } };
      const op: Record<string, unknown> = {
        tags: [bereich], ...(parameters.length ? { parameters } : {}),
        responses: { 200: ok, default: { description: 'Fehler', content: { 'application/json': { schema: { $ref: URI('Fehler') } } } } },
      };
      const rumpf = r.eingabe ? z.toJSONSchema(r.eingabe, { io: 'input', unrepresentable: 'any' }) : undefined;
      delete rumpf?.$schema;
      if (r.formular) op.requestBody = { content: { 'multipart/form-data': { schema: { ...rumpf, type: 'object',
        properties: { file: { type: 'string', format: 'binary' }, ...rumpf?.properties } } } } };
      else if (rumpf) op.requestBody = { content: { 'application/json': { schema: rumpf } } };
      if (r.bestaetigung) op['x-bestaetigung'] = r.bestaetigung;
      if (r.geheim) op['x-geheim'] = true;
      if (r.klein) op['x-klein'] = true;
      const oaPfad = pfad.replace(/:(\w+)/g, '{$1}');
      (paths[oaPfad] ??= {})[methode.toLowerCase()] = op;
    }
  }
  const sortiert = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: { title: 'BrickInventory API', version: String(API_VERSION),
      description: 'Erzeugt aus src/vertrag/ (npm run vertrag:openapi). Nicht von Hand ändern.' },
    paths: sortiert(paths),
    components: { schemas: sortiert(schemas) },
  };
}
