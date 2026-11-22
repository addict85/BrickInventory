/** The HTTP side of the API contract: router, validation, types of req/res; src/contract does not know Express. */
import express from 'express';
import type { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../infra/config';
import { routeFor, type Key, type ResponseBody, type Input, type Query } from '../contract';
import { unknownFields } from '../contract/unknownFields';
import { FLAT_INPUT, ErrorBody, PATH, type PathOf, type Route } from '../contract/base';
import { LARGEST_ID, idWert } from '../infra/validate';
import { handleRouteError, sendError } from './httpResponse';
import { bodyToV2 } from './apiV1Alias';

/** The type of `res` in a route: tsc reports where the response deviates from the contract. */
export type Reply<K extends Key> = [ResponseBody<K>] extends [never]
  ? Response
  : Response<ResponseBody<K> | z.input<typeof ErrorBody>>;
/** The type of `req` in a route: `input`, `queryArgs` and `pathArgs` as the contract checked them. */
export type Request0<K extends Key, R extends Request = AuthedRequest> = R & {
  input: Input<K>;
  queryArgs: Query<K>;
  pathArgs: PathOf<K>;
};
/** The same without requireToken. */
export type OpenRequest<K extends Key> = Request0<K, Request>;

/** A query value is a text: repeated (?a=1&a=2) it becomes a list, and
 * `.trim()` or a regex on it would mistake the type. */
const QUERY_AT_MOST = 4000;

/** Immediately before the route: it gets query and body as the schema converts them
 * (req.queryArgs, req.input), never raw. */
const IDS = new Set(['id', 'acqId', 'instrId']);

function validateInput(route: Route, req: Request, res: Response, next: NextFunction): void {
  bodyToV2(route, req, res);
  for (const [name, wert] of Object.entries(req.query ?? {}))
    if (typeof wert !== 'string' || wert.length > QUERY_AT_MOST) {
      sendError(req, res, 'ungueltig', 'input_invalid', { field: name.slice(0, 40) });
      return;
    }
  const checked = req as unknown as { input: unknown; queryArgs: unknown; pathArgs: Record<string, unknown> };
  checked.pathArgs = Object.create(null) as Record<string, unknown>;
  // Writing only happens under names from PATH, never under one from the request.
  for (const [name, schema] of Object.entries(PATH as Record<string, z.ZodType>)) {
    if (!Object.hasOwn(req.params ?? {}, name)) continue;
    const r = schema.safeParse(req.params[name]);
    if (!r.success) {
      if (IDS.has(name)) sendError(req, res, 'ungueltig', 'id_invalid');
      else sendError(req, res, 'ungueltig', 'input_invalid', { field: name });
      return;
    }
    checked.pathArgs[name] = r.data;
  }
  const fremd = Object.keys(req.params ?? {}).find(name => !Object.hasOwn(PATH, name));
  if (fremd) {
    sendError(req, res, 'ungueltig', 'input_invalid', { field: fremd.slice(0, 40) });
    return;
  }
  if (route.query) {
    const q = route.query.safeParse(req.query ?? {});
    if (!q.success) {
      reportDeviation(req, res, q.error);
      return;
    }
    checked.queryArgs = q.data;
  } else checked.queryArgs = {};
  checked.input = {};
  if (!route.input && (route.form || req.method === 'GET')) {
    next();
    return;
  }
  const r = (route.input ?? FLAT_INPUT).safeParse(req.body ?? {});
  if (!r.success) {
    reportDeviation(req, res, r.error);
    return;
  }
  checked.input = r.data;
  next();
}

/** The validators from validate.ts report their own error, an unknown field its code. */
function reportDeviation(req: Request, res: Response, error: z.ZodError): void {
  const first = error.issues[0];
  const own = (first as { params?: { error?: unknown } } | undefined)?.params?.error;
  if (own) {
    handleRouteError(res, own, 400, req);
    return;
  }
  if (first?.code === 'unrecognized_keys') {
    sendError(req, res, 'ungueltig', 'field_unknown', {
      field: [...(first.path ?? []), first.keys[0] ?? ''].join('.').slice(0, 40),
    });
    return;
  }
  sendError(req, res, 'ungueltig', 'input_invalid', { field: (first?.path ?? []).join('.').slice(0, 40) || '$' });
}

/** Only in tests (CHECK_CONTRACT=1): a 2xx response outside its schema becomes a 500. In
 * production this would cost a pass over whole lists per response; there tsc upholds the contract. */
function responseAgainstContract(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.contractChecked) {
    next();
    return;
  }
  res.locals.contractChecked = true;
  const send = res.json.bind(res);
  res.json = (body: unknown) => {
    const key = String(res.locals.contractKey ?? `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`);
    const route = res.statusCode < 300 && req.route ? routeFor(key) : undefined;
    const error: string[] = [];
    const check = (teil: string, schema: import('zod').ZodType | undefined, wert: unknown) => {
      const r = schema?.safeParse(wert);
      if (r && !r.success)
        error.push(...r.error.issues.slice(0, 8).map(i => `${teil} ${i.path.join('.') || '$'}: ${i.message}`));
    };
    if (route) {
      // What goes out is checked: a Date only becomes ISO text in res.json.
      const sent = JSON.parse(JSON.stringify(body ?? null));
      check('Antwort', route.response, sent);
      // Strict only here: a field outside the contract would be missing in OpenAPI and the UI's types.
      const fremd = !error.length && route.response ? unknownFields(route.response, sent) : [];
      if (fremd.length) error.push(`Antwort: nicht im Vertrag: ${fremd.join(', ')}`);
      if (!route.form) check('Anfrage', route.input, req.body ?? {});
    }
    // The error path has a shape too; without a check a 404 without a code went unnoticed.
    if (res.statusCode >= 400) check('Fehlerantwort', ErrorBody, JSON.parse(JSON.stringify(body ?? null)));
    if (!error.length) return send(body);
    console.error(`[vertrag] ${key}: ${error.join(' | ')}`);
    res.status(500);
    return send({
      success: false,
      error: `API-Vertrag verletzt: ${key}`,
      code: 'contract_violated',
      deviations: error,
    });
  };
  next();
}

/** Decided when the router is built, not per request: in production
 * the check is not even part of the chain. */
export function checkContract(): ((req: Request, res: Response, next: NextFunction) => void) | null {
  return config().checkContract ? responseAgainstContract : null;
}

/** Middleware that guarantees the rest of the chain a narrower request (AuthedRequest behind requireToken);
 * only what waechter() builds has the brand `sichert`, not any function in first position. */
export type Guard<R extends Request> = ((req: Request, res: Response, next: NextFunction) => void) & {
  readonly ensures: (r: R) => R;
};
export function guard<R extends Request>(f: (req: Request, res: Response, next: NextFunction) => void): Guard<R> {
  return Object.assign(f, { ensures: (r: R) => r });
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** The keys whose path lies under the router's prefix: any other does not compile. */
export type KeyBelow<P extends string> = Key extends infer K
  ? K extends `${Method} ${P}/${string}` | `${Method} ${P}`
    ? K
    : never
  : never;
/** What a route returns is put by the router into the envelope `{ success: true, … }`. Only
 * routes whose contract names `success` have one; the others answer themselves. */
export type Result<K extends Key> =
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
type ReturnValue<K extends Key> = Result<K> | Response | undefined | void;
/** An event of a stream in the same envelope as the query's response (contract: `ereignis`). */
export const inShell = <T extends object>(data: T) => ({ success: true as const, ...data });

export type Handler<K extends Key, R extends Request> = (
  req: Request0<K, R>,
  res: Reply<K>,
) => ReturnValue<K> | Promise<ReturnValue<K>>;
type IntermediateStep = (req: Request, res: Response, next: NextFunction) => unknown;

interface ContractRoutes<P extends string> {
  readonly praefix: P;
  /** Registers the route of the contract key: method, path and types come from it.
   * If a guard comes first, the route gets its request type. */
  endpoint<K extends KeyBelow<P>, R extends Request>(
    key: K,
    w: Guard<R>,
    ...steps: [...IntermediateStep[], Handler<K, R>]
  ): ContractRouter<P>;
  endpoint<K extends KeyBelow<P>>(key: K, ...steps: [...IntermediateStep[], Handler<K, Request>]): ContractRouter<P>;
  /** Mounts a router with the same or a longer prefix. */
  attachOne<Q extends `${P}${string}`>(kind: ContractRouter<Q>): ContractRouter<P>;
}
/** Like express.Router, but routes only via `endpoint`: a path without a contract key does not compile. */
export type ContractRouter<P extends string> = Omit<
  express.Router,
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'route'
> &
  express.RequestHandler &
  ContractRoutes<P>;

/** A router under a different prefix than that of its keys: its routes would be
 * reachable under a path the contract does not know. */
export class WrongMounted extends Error {
  constructor(praefix: string, basis: string) {
    super(`Vertragsrouter für ${praefix} ist unter ${basis || '/'} eingehängt`);
  }
}

/** Checks inputs in production and responses in tests, even without being mounted in routes/api/index.ts. */
export function contractRouter<P extends string>(praefix: P, o: { largeIds?: boolean } = {}): ContractRouter<P> {
  // As in the contract: a different spelling is a different route (404), not the same one without an entry.
  const router = express.Router({ caseSensitive: true });
  const check = checkContract();
  if (check) router.use(check);
  // A path ID that is too large would otherwise come out of PostgreSQL as a 500; jobs count in bigint (largeIds).
  const atMost = o.largeIds ? Number.MAX_SAFE_INTEGER : LARGEST_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, atMost) === null ? sendError(req, res, 'ungueltig', 'id_invalid') : next(),
    );
  }
  const login = (method: string, path: string, steps: unknown[]) =>
    (router as unknown as Record<string, (p: string, ...s: unknown[]) => unknown>)[method.toLowerCase()]?.(
      path,
      ...steps,
    );
  return Object.assign(router, {
    praefix,
    endpoint(key: string, ...steps: unknown[]) {
      const route = routeFor(key);
      const [method = '', path = ''] = key.split(' ');
      if (!route || !(path === praefix || path.startsWith(`${praefix}/`)))
        throw new Error(`${key} steht nicht im Vertrag unter ${praefix}`);
      const handler = steps.pop() as (req: Request, res: Response) => unknown;
      // As the last step before the route: responses from login and throttle (401, 429) stay.
      login(method, path.slice(praefix.length) || '/', [
        ...steps,
        (req: Request, res: Response, next: NextFunction) => {
          if (req.baseUrl.toLowerCase() !== praefix.toLowerCase()) throw new WrongMounted(praefix, req.baseUrl);
          res.locals.contractKey = key;
          // If the step guard at the entrance (res.locals.step set) assigned this route to a different
          // brand than Express did, its approval does not apply: closed instead of open.
          if (route.step && res.locals.step !== undefined && res.locals.step !== route.step)
            return sendError(req, res, 'verboten', 'step_approval_required');
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
    attachOne(kind: ContractRouter<string>) {
      if (!kind.praefix.startsWith(praefix)) throw new WrongMounted(kind.praefix, praefix);
      const rest = kind.praefix.slice(praefix.length);
      if (rest) router.use(rest, kind);
      else router.use(kind);
      return router;
    },
  }) as unknown as ContractRouter<P>;
}
