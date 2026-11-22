/** The API contract: one file per area, merged here. From it
 * arise docs/openapi.json (npm run vertrag:openapi), the types of the
 * routes (src/http/contractRouter.ts) and the response checks in the tests. */
import type { z } from 'zod';
import type { Wire, Route } from './base';
import * as bestand from './inventory';
import * as einstellungen from './settings';
import * as figuren from './minifigs';
import * as finanzen from './finances';
import * as geraet from './device';
import * as gutscheine from './vouchers';
import * as haushalt from './household';
import * as katalog from './catalog';
import * as konto from './account';
import * as merkliste from './wanted';
import * as sets from './sets';
import * as teile from './parts';
import * as verwaltung from './management';

export const AREAS = {
  bestand,
  einstellungen,
  figuren,
  finanzen,
  geraet,
  gutscheine,
  haushalt,
  katalog,
  konto,
  merkliste,
  sets,
  teile,
  verwaltung,
};

export const CONTRACT = {
  ...bestand.routen,
  ...einstellungen.routen,
  ...figuren.routen,
  ...finanzen.routen,
  ...geraet.routen,
  ...gutscheine.routen,
  ...haushalt.routen,
  ...katalog.routen,
  ...konto.routen,
  ...merkliste.routen,
  ...sets.routen,
  ...teile.routen,
  ...verwaltung.routen,
};

export type Key = keyof typeof CONTRACT;
type Body<K extends Key> = (typeof CONTRACT)[K] extends { antwort: infer S extends z.ZodType }
  ? Wire<z.output<S>>
  : never;
/** The body of a route, for services that compose it entirely. */
export type ResponseBody<K extends Key> = Body<K>;

type Teil<K extends Key, F extends 'eingabe' | 'abfrage'> = (typeof CONTRACT)[K] extends {
  [P in F]: infer S extends z.ZodType;
}
  ? z.output<S>
  : Record<never, never>;
/** The checked body (checkInput); empty without a schema. */
export type Input<K extends Key> = Teil<K, 'eingabe'>;
/** The checked query; empty without a schema, reading there is a translation error. */
export type Query<K extends Key> = Teil<K, 'abfrage'>;

export function routeFor(key: string): Route | undefined {
  return Object.hasOwn(CONTRACT, key) ? (CONTRACT as Record<string, Route>)[key] : undefined;
}

/** Literal segments before placeholders, as Express handles these paths. */
const MUSTER = Object.entries(CONTRACT as Record<string, Route>)
  .map(([k, route]) => {
    const [methode, path] = k.split(' ') as [string, string];
    const teile = path.split('/');
    return { schluessel: k as Key, methode, teile, route, offen: teile.filter(t => t.startsWith(':')).length };
  })
  .sort((a, b) => a.offen - b.offen);

function patternForRequest(methode: string, path: string) {
  const teile = path.replace(/\/+$/, '').split('/');
  return MUSTER.find(
    m =>
      m.methode === methode &&
      m.teile.length === teile.length &&
      m.teile.every((t, i) => t === teile[i] || (t.startsWith(':') && teile[i] !== '')),
  );
}

/** The contract route for a request, before Express has matched it. */
export function routeForRequest(methode: string, path: string): Route | undefined {
  return patternForRequest(methode, path)?.route;
}

/** Its key: whoever classifies routes by it names them the way the translator checks them. */
export function keyForRequest(methode: string, path: string): Key | undefined {
  return patternForRequest(methode, path)?.schluessel;
}
