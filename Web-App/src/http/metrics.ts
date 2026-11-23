/** HTTP side of the metrics: every response counted by route pattern and status, and the
 * /metrics endpoint. It answers only with METRICS_TOKEN or, without one, to a client on this
 * machine that did not come through a proxy; everyone else gets 404. */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { counter, histogram, renderMetrics } from '../infra/metrics';
import { keyForRequest } from '../contract';

const requests = counter('http_requests_total', 'HTTP responses by method, route pattern and status.');
const duration = histogram('http_request_duration_seconds', 'Time to the last byte, by method and route pattern.');

/** The pattern, never the raw path: set numbers and ids in it would grow the series without bound. */
export function routePattern(req: Pick<Request, 'method' | 'originalUrl' | 'url' | 'baseUrl' | 'route'>): string {
  const p = (req.originalUrl || req.url).split('?')[0] ?? '';
  if (p === '/api' || p.startsWith('/api/')) {
    const k = keyForRequest(req.method === 'HEAD' ? 'GET' : req.method, p);
    return k ? k.slice(k.indexOf(' ') + 1) : 'api_unknown';
  }
  const route = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof route === 'string') return `${req.baseUrl}${route}`;
  return /\.[a-z0-9]+$/i.test(p) ? 'static' : 'page';
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    const method = METHODS.has(req.method) ? req.method : 'other';
    const route = routePattern(req);
    requests.inc({ method, route, status: res.statusCode });
    duration.observe({ method, route }, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

/** Caddy always sets X-Forwarded-For: without a token, nothing that came from outside gets in. */
export function metricsAllowed(
  req: Pick<Request, 'headers'> & { socket: { remoteAddress?: string | undefined } },
  token: string | undefined,
): boolean {
  if (token) {
    const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
    return crypto.timingSafeEqual(digest(given), digest(token));
  }
  return (
    LOOPBACK.has(req.socket.remoteAddress ?? '') &&
    req.headers['x-forwarded-for'] === undefined &&
    req.headers.forwarded === undefined
  );
}

export function metricsEndpoint(token: string | undefined, collect: () => Promise<string> = renderMetrics) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.path !== '/metrics' || (req.method !== 'GET' && req.method !== 'HEAD')) {
      next();
      return;
    }
    if (!metricsAllowed(req, token)) {
      res.status(404).end();
      return;
    }
    try {
      const text = await collect();
      res.setHeader('Cache-Control', 'no-store');
      // Set by hand: res.type() would reorder the parameters of the exposition format.
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : text);
    } catch (e) {
      next(e);
    }
  };
}
