/** The API contract: one file per area, merged here. From it
 * arise docs/openapi.json (npm run contract:openapi), the types of the
 * routes (src/http/contractRouter.ts) and the response checks in the tests. */
import type { z } from 'zod';
import type { Wire, Route } from './base';
import * as inventory from './inventory';
import * as settings from './settings';
import * as minifigs from './minifigs';
import * as finances from './finances';
import * as device from './device';
import * as vouchers from './vouchers';
import * as household from './household';
import * as catalog from './catalog';
import * as account from './account';
import * as wanted from './wanted';
import * as sets from './sets';
import * as parts from './parts';
import * as management from './management';

export const AREAS = {
  inventory,
  settings,
  minifigs,
  finances,
  device,
  vouchers,
  household,
  catalog,
  account,
  wanted,
  sets,
  parts,
  management,
};

export const CONTRACT = {
  ...inventory.routes,
  ...settings.routes,
  ...minifigs.routes,
  ...finances.routes,
  ...device.routes,
  ...vouchers.routes,
  ...household.routes,
  ...catalog.routes,
  ...account.routes,
  ...wanted.routes,
  ...sets.routes,
  ...parts.routes,
  ...management.routes,
};

export type Key = keyof typeof CONTRACT;
type Body<K extends Key> = (typeof CONTRACT)[K] extends { response: infer S extends z.ZodType }
  ? Wire<z.output<S>>
  : never;
/** The body of a route, for services that compose it entirely. */
export type ResponseBody<K extends Key> = Body<K>;

type Part<K extends Key, F extends 'input' | 'query'> = (typeof CONTRACT)[K] extends {
  [P in F]: infer S extends z.ZodType;
}
  ? z.output<S>
  : Record<never, never>;
/** The checked body (checkInput); empty without a schema. */
export type Input<K extends Key> = Part<K, 'input'>;
/** The checked query; empty without a schema, reading there is a translation error. */
export type Query<K extends Key> = Part<K, 'query'>;

export function routeFor(key: string): Route | undefined {
  return Object.hasOwn(CONTRACT, key) ? (CONTRACT as Record<string, Route>)[key] : undefined;
}

/** Literal segments before placeholders, as Express handles these paths. */
const PATTERNS = Object.entries(CONTRACT as Record<string, Route>)
  .map(([k, route]) => {
    const [method, path] = k.split(' ') as [string, string];
    const parts = path.split('/');
    return { key: k as Key, method, parts, route, open: parts.filter(t => t.startsWith(':')).length };
  })
  .sort((a, b) => a.open - b.open);

function patternForRequest(method: string, path: string) {
  const parts = path.replace(/\/+$/, '').split('/');
  return PATTERNS.find(
    m =>
      m.method === method &&
      m.parts.length === parts.length &&
      m.parts.every((t, i) => t === parts[i] || (t.startsWith(':') && parts[i] !== '')),
  );
}

/** The contract route for a request, before Express has matched it. */
export function routeForRequest(method: string, path: string): Route | undefined {
  return patternForRequest(method, path)?.route;
}

/** Its key: whoever classifies routes by it names them the way the translator checks them. */
export function keyForRequest(method: string, path: string): Key | undefined {
  return patternForRequest(method, path)?.key;
}
