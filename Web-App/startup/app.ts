/** The Express app: middleware, session, files and routers in their order.
 * server.ts only starts; tests build the same app (test/helpers/server.js). */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import type { Pool } from 'pg';
import type { AppConfig } from '../src/infra/config';
import { requestContext, requestId } from '../src/infra/log';
import { errorResponse, unknownApiPath } from '../src/http/httpResponse';
import { sessionCookieName, sessionCookieOptions } from '../src/http/sessionCookie';
import {
  touchMs,
  touchThrottle,
  hashSessionIds,
  sessionDeadlines,
  sessionIdleMs,
  sessionIdleSec,
  sessionMaxDuration,
} from '../src/account';
import { startPageStyleHash, type ProfileServices } from '../src/profile';
import { checkSessionVersion } from '../src/account/http/sessionCheck';
import type { AccountServices } from '../src/account';
import { rememberRequest } from '../src/http/rememberAccount';
import { proxyTrust } from '../src/infra/proxyTrust';
import { proxyHint } from '../src/http/proxyHint';
import { onlyOwnOrigin, onlyOwnHost } from '../src/http/origin';
import { apiV1Alias } from '../src/http/apiV1Alias';
import { API_VERSION, API_MIN_APP, checkAppVersion } from '../src/http/apiVersion';
import { PUBLIC_DIR } from '../src/infra/appPaths';
import { sendStartPage } from '../src/profile/http/startPage';
import { registerImgProxy } from '../routes/imgProxy';
import { guardFor, readBody } from '../routes/api/middleware';
import { stepProtectionAtInbox } from '../src/account/http/stepGuard';
import { apiThrottle } from '../src/http/apiThrottle';
import { httpMetrics, metricsEndpoint } from '../src/http/metrics';
import { idempotency } from '../src/idempotency/http/middleware';
import { buildDataFilesRouter } from '../routes/dataFiles';
import { buildApiRouter } from '../routes/api/index';
import { buildAuthRouter } from '../routes/auth';
import { buildCertificateRouter } from '../routes/certificate';
import { buildCspReportRouter } from '../src/http/cspReport';
import { buildWellKnownRouter } from '../routes/wellKnown';
import { buildGesundheitRouter } from '../routes/health';
import { buildPagesRouter } from '../routes/pages';
import { checkContract } from '../src/http/contractRouter';
import type { Services } from './wiring';

export interface AppIngredients {
  /** For the session store (user_sessions): the system role's pool; the runtime role does not read it. */
  pool: Pool;
  config: AppConfig;
  /** Checked in server.ts: a placeholder ends the startup there. */
  sessionSecret: string;
  /** The routes get their services from here (startup/wiring.ts, buildServices). */
  services: Services;
  /** Sets req.session; without a value express-session via user_sessions. A test provides
   * its session here; the checks after it (version, maximum duration) stay the real ones. */
  sessionStorage?: RequestHandler;
}

/** The sections are in the order of the middleware. */
export function buildApp({ pool, config, sessionSecret, services, sessionStorage }: AppIngredients): express.Express {
  const app = express();
  // Only reveals what the server is built with — whoever searches should not get it for free.
  app.disable('x-powered-by');
  // Before the first app.use: an /API/… would otherwise hit the same route, but no contract entry.
  app.set('case sensitive routing', true);
  baselineProtection(app, config);
  sessionRow(app, sessionStorage ?? sessionInPostgres(pool, sessionSecret, config), services.account, config);
  filesAndImages(app, services, config);
  apiRoutes(app, services);
  fallbacks(app, services.profile);
  return app;
}

function baselineProtection(app: express.Express, k: AppConfig): void {
  // First of all: every response, even a 421 of the host filter, carries the identifier and is counted.
  // The proxy's identifier only if it passes src/infra/log.ts.
  app.use((req, res, next) => {
    const rid = requestId(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', rid);
    requestContext.run({ rid }, () => next());
  });
  app.use(httpMetrics);
  // Before the host filter: a scraper asks by container name, which is no public host.
  app.use(metricsEndpoint(k.metricsToken));
  // Gzip/Brotli for everything from 1 KB; index.html shrinks by about 80 %.
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        // Do NOT compress SSE streams — they must go out immediately. includes() instead of
        // equality, because OkHttp sends `text/event-stream, */*`.
        if (String(req.headers.accept || '').includes('text/event-stream')) return false;
        if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Hand-rolled instead of helmet: no additional dependency, and the CSP has to
  // be tailored to the app anyway.
  app.use(securityHeaders(k.hstsMaxAge, k.production));

  // The request's account for counters deep down (src/externalSources/apiQuota.ts).
  app.use(rememberRequest);

  // Otherwise Express never believes X-Forwarded-Proto and sets no secure cookie (src/infra/proxyTrust.ts).
  if (k.operation) {
    app.set('trust proxy', proxyTrust(k.trustProxy, k.proxyNetworkConfirmed));
  }
  // Outside production too: it reports a discarded X-Forwarded-For.
  app.locals.proxyHint = proxyHint(k.trustProxy, console.warn, Date.now, k.proxyNetworkConfirmed);
  app.use(app.locals.proxyHint);

  // `//api/…` would otherwise fall through to the SPA catch-all and get index.html with 200.
  app.use((req, _res, next) => {
    if (req.url.startsWith('//') || req.url.includes('//', 1)) {
      const [pathTeil, ...rest] = req.url.split('?');
      const pathPart = pathTeil ?? '';
      const cleaned = pathPart.replace(/\/{2,}/g, '/');
      if (cleaned !== pathPart) req.url = cleaned + (rest.length ? '?' + rest.join('?') : '');
    }
    next();
  });

  // Before everything that reads the path: from here on there is only /api/v2.
  app.use(apiV1Alias);
  app.use(onlyOwnHost);
  // Before the origin check: browsers send CSP reports without a reliable origin.
  app.use(buildCspReportRouter());
  app.use(onlyOwnOrigin);
  // no-store as the default: responses carry accounts, vouchers and tokens. Whatever is deliberately
  // cached (img-proxy, theme) sets its own header and overwrites it.
  app.use(
    '/api',
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Api-Version', String(API_VERSION));
      res.setHeader('X-Api-Min-App', String(API_MIN_APP));
      next();
    },
    checkAppVersion,
  );
}

const securityHeaders =
  (hstsAlter: number, production: boolean) =>
  (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    // No foreign window keeps a handle on the app, no foreign page embeds its responses.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // HSTS only over TLS. req.secure, because Express only accepts X-Forwarded-Proto from a
    // trusted proxy; any client can send the raw header.
    const viaTls = req.secure;
    // hstsAlter: default one year, 0 switches it off.
    if (viaTls && hstsAlter !== 0) {
      res.setHeader('Strict-Transport-Security', `max-age=${hstsAlter}; includeSubDomains`);
    }

    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // Without 'unsafe-inline': all handlers run via js/aktionen.js.
        "script-src 'self'",
        // Styles are set by js/styles.js via CSSOM; inline only the start skeleton, by hash.
        `style-src 'self'${startPageStyleHash(production) ? ' ' + startPageStyleHash(production) : ''}`,
        "font-src 'self'",
        // Without https:: foreign images go through the image proxy, and an injected
        // <img src="https://foreign/?data"> would otherwise be a channel to the outside.
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:", // PDF.js worker (local /vendor/pdfjs, possibly blob:)
        "frame-ancestors 'self'", // the own PDF viewer embeds same-origin PDFs via <iframe>
        // default-src does not cover these three: form to the outside, <base> for
        // redirecting, <object>/<embed> for plugins.
        "form-action 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        // Markup only via setzeHtml() (policy app); `default` only lets the own script addresses through.
        "require-trusted-types-for 'script'",
        'trusted-types app default',
        'report-uri /csp-bericht',
        'report-to csp',
      ].join('; '),
    );
    res.setHeader('Reporting-Endpoints', 'csp="/csp-bericht"');
    next();
  };

function sessionInPostgres(pool: Pool, secret: string, k: AppConfig): RequestHandler {
  // In PostgreSQL, so that sessions survive a restart; the schema creates the table.
  const PgSession = connectPgSimple(session);
  const sessionStorage = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15,
    // After hours of idleness a web app session ends.
    ttl: sessionIdleSec(k),
    errorLog: err => {
      if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
        console.error('[session-store]', err.message);
      }
    },
  });

  // Written throttled (src/account/sessionTouch.ts).
  touchThrottle(sessionStorage, touchMs(sessionIdleMs(k)));
  // Outermost, so that the throttle's memory also only keys by the hash.
  hashSessionIds(sessionStorage);

  return session({
    store: sessionStorage,
    secret: secret,
    resave: false,
    saveUninitialized: false,
    name: sessionCookieName(),
    cookie: sessionCookieOptions(),
  });
}

function sessionRow(app: express.Express, store: RequestHandler, account: AccountServices, k: AppConfig): void {
  app.use(store);
  app.use(checkSessionVersion(account));
  app.use(sessionMaxDuration(sessionDeadlines(k)));
}

function filesAndImages(app: express.Express, d: Services, config: AppConfig): void {
  app.use(buildDataFilesRouter(d));
  app.use(buildCertificateRouter());
  app.use(buildWellKnownRouter(config));
  registerImgProxy(app, d);

  app.use(buildPagesRouter(d));
  app.use(
    express.static(PUBLIC_DIR, {
      // `/` goes through the renderer (src/profile/indexHtml.ts), not as a file.
      index: false,
      // Cache stamped assets (?v=) for a long time; index.html no-cache, so that deploys apply immediately.
      maxAge: '7d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
}

function apiRoutes(app: express.Express, d: Services): void {
  const check = checkContract();
  if (check) app.use('/api/v2', check);
  // Express would find `/vouchers/1/klartext/` under `/vouchers/:id/klartext`; everything before it (throttle,
  // step guard, Caddy) sees a different path. With `/` at the end the contract only knows `/api/v2/`.
  app.use('/api', (req, res, next) =>
    req.path !== '/v2/' && req.path.length > 1 && req.path.endsWith('/') ? unknownApiPath(req, res) : next(),
  );
  // Before the entrance: asked before schema, migrations and /api/v2 routers are in place.
  app.use('/api/v2', buildGesundheitRouter(d));
  apiInbox(app, d);
  app.use('/api/v2', buildApiRouter(d));
  app.use('/api/v2/auth', buildAuthRouter(d));
}

/** The entrance in front of all /api/v2 routers. */
function apiInbox(app: express.Express, d: Services): void {
  // ONE entrance: loginAtInbox requires a session or token for everything under
  // /api/v2 except the explicitly public paths. The protection per route
  // stays as a second line.
  app.use('/api/v2', guardFor(d.account).loginAtInbox);
  // Then the budget per account, BEFORE the body: a rejected request should
  // no longer read its body (src/http/apiThrottle.ts).
  app.use('/api/v2', apiThrottle(d.throttle));
  // Sensitive steps of an app token only after the device lock (src/account/http/stepGuard.ts).
  app.use('/api/v2', stepProtectionAtInbox(d.account));
  // Read bodies only after login: unauthenticated there are only 16 KB (readBody).
  app.use('/api/v2', readBody);
  app.use('/api/v2', idempotency(d.idempotency));
}

function fallbacks(app: express.Express, profile: ProfileServices): void {
  // BEFORE the SPA catch-all: otherwise a typo in the API path would get the
  // index.html with 200. Regardless of case; the routes before it pay attention to that.
  app.use((req, res, next) => (/^\/api(\/|$)/i.test(req.path) ? unknownApiPath(req, res) : next()));

  // '{*splat}' instead of '/*splat': Express 5 requires a name, and the
  // obvious form would not match the start page `/`.
  app.get('/{*splat}', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    await sendStartPage(profile, res, req.session?.userId);
  });

  // The one error path of all routers: an error skips everything without an error parameter
  // up to here; the routers themselves do not attach their own.
  app.use(errorResponse);
}
