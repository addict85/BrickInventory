/** /api/v1 as a deprecated alias of /api/v2: the path is rewritten before any other middleware, so
 * login, throttle, step guard and routes exist once. What crosses the boundary is translated
 * along the contract (src/contract/v1.ts): query and body to v2, responses, errors and events to v1. */
import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import { CONTRACT, routeFor, type Key } from '../contract';
import { v1Key } from '../contract/v1Routes';
import { errorToV1, translate } from '../contract/v1';
import { SUNSET_DAY } from '../contract/version';
import { PATH, type Route } from '../contract/base';

const V1 = '/api/v1';
const V2 = '/api/v2';
/** Image addresses in stored rows point here; the proxy answers with images, not with the API. */
const UNTOUCHED = new Set(['/api/v1/img-proxy']);
const SUNSET = new Date(`${SUNSET_DAY}T00:00:00Z`).toUTCString();

const PATTERNS = Object.keys(CONTRACT)
  .map(key => {
    const [method = '', path = ''] = v1Key(key).split(' ');
    const parts = path.split('/');
    return { key: key as Key, method, parts, v2: (key.split(' ')[1] ?? '').split('/') };
  })
  .sort((a, b) => a.parts.filter(p => p.startsWith(':')).length - b.parts.filter(p => p.startsWith(':')).length);

/** The v2 path and contract key of a v1 request path. */
export function v2PathOf(method: string, path: string): { path: string; key?: Key } {
  const parts = path.replace(/\/+$/, '').split('/');
  const m = method === 'HEAD' ? 'GET' : method;
  const hit = PATTERNS.find(
    p =>
      p.method === m &&
      p.parts.length === parts.length &&
      p.parts.every((t, i) => t === parts[i] || (t.startsWith(':') && parts[i] !== '')),
  );
  if (!hit) return { path: V2 + path.slice(V1.length) };
  const param = (name: string, value: string) => {
    const mapped = translate((PATH as Record<string, z.ZodType>)[name], value, 'v2');
    return typeof mapped === 'string' ? mapped : value;
  };
  return {
    path: hit.v2.map((t, i) => (t.startsWith(':') ? param(t.slice(1), parts[i] ?? '') : t)).join('/'),
    key: hit.key,
  };
}

function translatedQuery(route: Route | undefined, search: string): string {
  if (!route?.query || !search) return search;
  const params = new URLSearchParams(search);
  const raw: Record<string, string> = {};
  for (const [k, v] of params) raw[k] = v;
  const v2 = translate(route.query, raw, 'v2') as Record<string, string>;
  return `?${new URLSearchParams(v2).toString()}`;
}

export function apiV1Alias(req: Request, res: Response, next: NextFunction): void {
  const [path = '', query = ''] = req.url.split(/\?(.*)/s);
  if (!(path === V1 || path.startsWith(`${V1}/`)) || UNTOUCHED.has(path)) {
    next();
    return;
  }
  const { path: v2Path, key } = v2PathOf(req.method, path);
  const route = key ? routeFor(key) : undefined;
  req.url = v2Path + translatedQuery(route, query ? `?${query}` : '');
  res.locals.apiV1 = true;
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', SUNSET);
  res.setHeader('Link', `<${v2Path}>; rel="successor-version"`);
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const failed = res.statusCode >= 400 || (body as { success?: unknown } | null)?.success === false;
    const r = routeFor(String(res.locals.contractKey ?? key ?? ''));
    return json(failed ? errorToV1(body) : translate(r?.response, body, 'v1'));
  };
  next();
}

/** The body as the v2 route expects it; runs where the route checks its input (contractRouter). */
export function bodyToV2(route: Route, req: Request, res: Response): void {
  if (res.locals.apiV1 && route.input && req.body && typeof req.body === 'object')
    req.body = translate(route.input, req.body, 'v2');
}

/** An event or NDJSON line of a v1 request, along the route's event (or response) schema. */
export function lineToV1(res: Response, data: object, schema?: z.ZodType): object {
  if (!res.locals?.apiV1) return data;
  if ((data as { success?: unknown }).success === false) return errorToV1(data) as object;
  const r = routeFor(String(res.locals.contractKey ?? ''));
  return translate(schema ?? r?.event ?? r?.response, data, 'v1') as object;
}
