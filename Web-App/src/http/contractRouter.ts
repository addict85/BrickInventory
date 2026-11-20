/** The HTTP side of the API contract: router, validation, types of req/res; src/contract does not know Express. */
import express from 'express';
import type { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../infra/config';
import { routeZu, type Schluessel, type ResponseBody, type Eingabe, type Abfrage } from '../contract';
import { unbekannteFelder } from '../contract/unknownFields';
import { FLAT_INPUT, Fehler, PATH, type PathOf, type Route } from '../contract/base';
import { LARGEST_ID, idWert } from '../infra/validate';
import { handleRouteError, sendError } from './httpResponse';

/** The type of `res` in a route: tsc reports where the response deviates from the contract. */
export type Antwort<K extends Schluessel> = [ResponseBody<K>] extends [never]
  ? Response
  : Response<ResponseBody<K> | z.input<typeof Fehler>>;
/** The type of `req` in a route: `eingabe`, `abfrage` and `pfad` as the contract checked them. */
export type Anfrage<K extends Schluessel, R extends Request = AuthedRequest> = R & {
  eingabe: Eingabe<K>;
  abfrage: Abfrage<K>;
  pfad: PathOf<K>;
};
/** The same without requireToken. */
export type OpenRequest<K extends Schluessel> = Anfrage<K, Request>;

/** A query value is a text: repeated (?a=1&a=2) it becomes a list, and
 * `.trim()` or a regex on it would mistake the type. */
const QUERY_AT_MOST = 4000;

/** Immediately before the route: it gets query and body as the schema converts them
 * (req.abfrage, req.eingabe), never raw. */
const IDS = new Set(['id', 'acqId', 'instrId']);

function validateInput(route: Route, req: Request, res: Response, next: NextFunction): void {
  for (const [name, wert] of Object.entries(req.query ?? {}))
    if (typeof wert !== 'string' || wert.length > QUERY_AT_MOST) {
      sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: name.slice(0, 40) });
      return;
    }
  const geprueft = req as unknown as { eingabe: unknown; abfrage: unknown; pfad: Record<string, unknown> };
  geprueft.pfad = Object.create(null) as Record<string, unknown>;
  // Writing only happens under names from PATH, never under one from the request.
  for (const [name, schema] of Object.entries(PATH as Record<string, z.ZodType>)) {
    if (!Object.hasOwn(req.params ?? {}, name)) continue;
    const r = schema.safeParse(req.params[name]);
    if (!r.success) {
      if (IDS.has(name)) sendError(req, res, 'ungueltig', 'id_ungueltig');
      else sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: name });
      return;
    }
    geprueft.pfad[name] = r.data;
  }
  const fremd = Object.keys(req.params ?? {}).find(name => !Object.hasOwn(PATH, name));
  if (fremd) {
    sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: fremd.slice(0, 40) });
    return;
  }
  if (route.abfrage) {
    const q = route.abfrage.safeParse(req.query ?? {});
    if (!q.success) {
      reportDeviation(req, res, q.error);
      return;
    }
    geprueft.abfrage = q.data;
  } else geprueft.abfrage = {};
  geprueft.eingabe = {};
  if (!route.eingabe && (route.formular || req.method === 'GET')) {
    next();
    return;
  }
  const r = (route.eingabe ?? FLAT_INPUT).safeParse(req.body ?? {});
  if (!r.success) {
    reportDeviation(req, res, r.error);
    return;
  }
  geprueft.eingabe = r.data;
  next();
}

/** The validators from validate.ts report their own error, an unknown field its code. */
function reportDeviation(req: Request, res: Response, fehler: z.ZodError): void {
  const erste = fehler.issues[0];
  const eigener = (erste as { params?: { fehler?: unknown } } | undefined)?.params?.fehler;
  if (eigener) {
    handleRouteError(res, eigener, 400, req);
    return;
  }
  if (erste?.code === 'unrecognized_keys') {
    sendError(req, res, 'ungueltig', 'feld_unbekannt', {
      feld: [...(erste.path ?? []), erste.keys[0] ?? ''].join('.').slice(0, 40),
    });
    return;
  }
  sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: (erste?.path ?? []).join('.').slice(0, 40) || '$' });
}

/** Only in tests (VERTRAG_PRUEFEN=1): a 2xx response outside its schema becomes a 500. In
 * production this would cost a pass over whole lists per response; there tsc upholds the contract. */
function responseAgainstContract(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.contractChecked) {
    next();
    return;
  }
  res.locals.contractChecked = true;
  const senden = res.json.bind(res);
  res.json = (rumpf: unknown) => {
    const schluessel = String(res.locals.contractKey ?? `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`);
    const route = res.statusCode < 300 && req.route ? routeZu(schluessel) : undefined;
    const fehler: string[] = [];
    const pruefe = (teil: string, schema: import('zod').ZodType | undefined, wert: unknown) => {
      const r = schema?.safeParse(wert);
      if (r && !r.success)
        fehler.push(...r.error.issues.slice(0, 8).map(i => `${teil} ${i.path.join('.') || '$'}: ${i.message}`));
    };
    if (route) {
      // What goes out is checked: a Date only becomes ISO text in res.json.
      const gesendet = JSON.parse(JSON.stringify(rumpf ?? null));
      pruefe('Antwort', route.antwort, gesendet);
      // Strict only here: a field outside the contract would be missing in OpenAPI and the UI's types.
      const fremd = !fehler.length && route.antwort ? unbekannteFelder(route.antwort, gesendet) : [];
      if (fremd.length) fehler.push(`Antwort: nicht im Vertrag: ${fremd.join(', ')}`);
      if (!route.formular) pruefe('Anfrage', route.eingabe, req.body ?? {});
    }
    // The error path has a shape too; without a check a 404 without a code went unnoticed.
    if (res.statusCode >= 400) pruefe('Fehlerantwort', Fehler, JSON.parse(JSON.stringify(rumpf ?? null)));
    if (!fehler.length) return senden(rumpf);
    console.error(`[vertrag] ${schluessel}: ${fehler.join(' | ')}`);
    res.status(500);
    return senden({
      success: false,
      error: `API-Vertrag verletzt: ${schluessel}`,
      code: 'vertrag_verletzt',
      deviations: fehler,
    });
  };
  next();
}

/** Decided when the router is built, not per request: in production
 * the check is not even part of the chain. */
export function checkContract(): ((req: Request, res: Response, next: NextFunction) => void) | null {
  return konfig().checkContract ? responseAgainstContract : null;
}

/** Middleware that guarantees the rest of the chain a narrower request (AuthedRequest behind requireToken);
 * only what waechter() builds has the brand `sichert`, not any function in first position. */
export type Waechter<R extends Request> = ((req: Request, res: Response, next: NextFunction) => void) & {
  readonly sichert: (r: R) => R;
};
export function guard<R extends Request>(f: (req: Request, res: Response, next: NextFunction) => void): Waechter<R> {
  return Object.assign(f, { sichert: (r: R) => r });
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** The keys whose path lies under the router's prefix: any other does not compile. */
export type KeyBelow<P extends string> = Schluessel extends infer K
  ? K extends `${Method} ${P}/${string}` | `${Method} ${P}`
    ? K
    : never
  : never;
/** What a route returns is put by the router into the envelope `{ success: true, … }`. Only
 * routes whose contract names `success` have one; the others answer themselves. */
export type Ergebnis<K extends Schluessel> =
  ResponseBody<K> extends infer R
    ? [keyof R] extends [never]
      ? [R] extends [never]
        ? never
        : Record<string, unknown>
      : 'success' extends keyof R
        ? Omit<R, 'success'>
        : never
    : never;
// biome-ignore lint/suspicious/noConfusingVoidType: a route also answers itself (`return sendError(…)`), and that is void.
type ReturnValue<K extends Schluessel> = Ergebnis<K> | Response | undefined | void;
/** An event of a stream in the same envelope as the query's response (contract: `ereignis`). */
export const inShell = <T extends object>(daten: T) => ({ success: true as const, ...daten });

export type Handler<K extends Schluessel, R extends Request> = (
  req: Anfrage<K, R>,
  res: Antwort<K>,
) => ReturnValue<K> | Promise<ReturnValue<K>>;
type IntermediateStep = (req: Request, res: Response, next: NextFunction) => unknown;

interface Vertragswege<P extends string> {
  readonly praefix: P;
  /** Registers the route of the contract key: method, path and types come from it.
   * If a guard comes first, the route gets its request type. */
  endpunkt<K extends KeyBelow<P>, R extends Request>(
    schluessel: K,
    w: Waechter<R>,
    ...schritte: [...IntermediateStep[], Handler<K, R>]
  ): VertragsRouter<P>;
  endpunkt<K extends KeyBelow<P>>(
    schluessel: K,
    ...schritte: [...IntermediateStep[], Handler<K, Request>]
  ): VertragsRouter<P>;
  /** Mounts a router with the same or a longer prefix. */
  attachOne<Q extends `${P}${string}`>(kind: VertragsRouter<Q>): VertragsRouter<P>;
}
/** Like express.Router, but routes only via `endpunkt`: a path without a contract key does not compile. */
export type VertragsRouter<P extends string> = Omit<
  express.Router,
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'route'
> &
  express.RequestHandler &
  Vertragswege<P>;

/** A router under a different prefix than that of its keys: its routes would be
 * reachable under a path the contract does not know. */
export class WrongMounted extends Error {
  constructor(praefix: string, basis: string) {
    super(`Vertragsrouter für ${praefix} ist unter ${basis || '/'} eingehängt`);
  }
}

/** Checks inputs in production and responses in tests, even without being mounted in routes/api_v1/index.ts. */
export function vertragsRouter<P extends string>(praefix: P, o: { largeIds?: boolean } = {}): VertragsRouter<P> {
  // As in the contract: a different spelling is a different route (404), not the same one without an entry.
  const router = express.Router({ caseSensitive: true });
  const check = checkContract();
  if (check) router.use(check);
  // A path ID that is too large would otherwise come out of PostgreSQL as a 500; jobs count in bigint (largeIds).
  const hoechstens = o.largeIds ? Number.MAX_SAFE_INTEGER : LARGEST_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, hoechstens) === null ? sendError(req, res, 'ungueltig', 'id_ungueltig') : next(),
    );
  }
  const anmelden = (methode: string, pfad: string, schritte: unknown[]) =>
    (router as unknown as Record<string, (p: string, ...s: unknown[]) => unknown>)[methode.toLowerCase()]?.(
      pfad,
      ...schritte,
    );
  return Object.assign(router, {
    praefix,
    endpunkt(schluessel: string, ...schritte: unknown[]) {
      const route = routeZu(schluessel);
      const [methode = '', pfad = ''] = schluessel.split(' ');
      if (!route || !(pfad === praefix || pfad.startsWith(`${praefix}/`)))
        throw new Error(`${schluessel} steht nicht im Vertrag unter ${praefix}`);
      const handler = schritte.pop() as (req: Request, res: Response) => unknown;
      // As the last step before the route: responses from login and throttle (401, 429) stay.
      anmelden(methode, pfad.slice(praefix.length) || '/', [
        ...schritte,
        (req: Request, res: Response, next: NextFunction) => {
          if (req.baseUrl.toLowerCase() !== praefix.toLowerCase()) throw new WrongMounted(praefix, req.baseUrl);
          res.locals.contractKey = schluessel;
          // If the step guard at the entrance (res.locals.schritt set) assigned this route to a different
          // brand than Express did, its approval does not apply: closed instead of open.
          if (route.schritt && res.locals.schritt !== undefined && res.locals.schritt !== route.schritt)
            return sendError(req, res, 'verboten', 'schritt_freigabe_noetig');
          validateInput(route, req, res, next);
        },
        async (req: Request, res: Response) => {
          const r = await handler(req, res);
          if (r === undefined || r === res || res.headersSent) return;
          res.json({ success: true, ...(r as object) });
        },
      ]);
      return router;
    },
    attachOne(kind: VertragsRouter<string>) {
      if (!kind.praefix.startsWith(praefix)) throw new WrongMounted(kind.praefix, praefix);
      const rest = kind.praefix.slice(praefix.length);
      if (rest) router.use(rest, kind);
      else router.use(kind);
      return router;
    },
  }) as unknown as VertragsRouter<P>;
}
