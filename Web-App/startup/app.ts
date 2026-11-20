/** Die Express-App: Middleware, Sitzung, Dateien und Router in ihrer Reihenfolge.
 * server.ts startet nur; Tests bauen dieselbe App (test/helpers/server.js). */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import type { Pool } from 'pg';
import type { Konfig } from '../src/infra/konfig';
import { requestContext, anfrageKennung } from '../src/infra/protokoll';
import { errorResponse, unknownApiPath } from '../src/http/httpAntwort';
import { sitzungsKeksName, sessionCookieOptions } from '../src/http/sitzungsKeks';
import {
  touchMs,
  touchThrottle,
  sitzungsfristen,
  sessionIdleMs,
  sessionIdleSec,
  sessionMaxDuration,
} from '../src/konto';
import { startPageStyleHash, type ProfileServices } from '../src/profile';
import { checkSessionVersion } from '../src/konto/http/sitzungsPruefung';
import type { AccountServices } from '../src/konto';
import { rememberRequest } from '../src/http/kontoMerken';
import { proxyVertrauen } from '../src/infra/proxyVertrauen';
import { proxyHinweis } from '../src/http/proxyHinweis';
import { onlyOwnOrigin, onlyOwnHost } from '../src/http/herkunft';
import { API_VERSION, API_MIN_APP, checkAppVersion } from '../src/http/apiVersion';
import { PUBLIC_DIR } from '../src/infra/appPaths';
import { sendStartPage } from '../src/profile/http/startPage';
import { registerImgProxy } from '../routes/imgProxy';
import { guardFor, readBody } from '../routes/api_v1/middleware';
import { stepChutzAtInbox } from '../src/konto/http/schrittschutz';
import { apiDrossel } from '../src/http/apiDrossel';
import { idempotency } from '../src/idempotency/http/middleware';
import { buildDataFilesRouter } from '../routes/datenDateien';
import { buildApiRouter } from '../routes/api_v1/index';
import { buildAuthRouter } from '../routes/auth';
import { buildCertificateRouter } from '../routes/zertifikat';
import { buildCspReportRouter } from '../src/http/cspBericht';
import { buildWellKnownRouter } from '../routes/wellKnown';
import { buildGesundheitRouter } from '../routes/gesundheit';
import { buildPagesRouter } from '../routes/seiten';
import { checkContract } from '../src/http/vertragsRouter';
import type { Dienste } from './verdrahtung';

export interface AppIngredients {
  /** Für den Sitzungsspeicher (user_sessions): der Pool der Systemrolle, die Laufzeitrolle liest sie nicht. */
  pool: Pool;
  konfig: Konfig;
  /** Geprüft in server.ts: Ein Platzhalter beendet dort den Start. */
  sitzungsGeheimnis: string;
  /** Die Routen bekommen ihre Dienste von hier (startup/verdrahtung.ts, buildServices). */
  dienste: Dienste;
  /** Setzt req.session; ohne Angabe express-session über user_sessions. Ein Test stellt
   * hier seine Sitzung, die Prüfungen danach (Version, Höchstdauer) bleiben die echten. */
  sessionStorage?: RequestHandler;
}

/** Die Abschnitte stehen in der Reihenfolge der Middleware. */
export function baueApp({ pool, konfig, sitzungsGeheimnis, dienste, sessionStorage }: AppIngredients): express.Express {
  const app = express();
  // Verrät nur, womit der Server gebaut ist — wer sucht, soll es nicht geschenkt bekommen.
  app.disable('x-powered-by');
  // Vor dem ersten app.use: Ein /API/… träfe sonst dieselbe Route, aber keinen Vertragseintrag.
  app.set('case sensitive routing', true);
  baselineProtection(app, konfig);
  sitzung(app, sessionStorage ?? sessionInPostgres(pool, sitzungsGeheimnis, konfig), dienste.konto, konfig);
  filesAndImages(app, dienste, konfig);
  apiRoutes(app, dienste);
  fallbacks(app, dienste.profile);
  return app;
}

function baselineProtection(app: express.Express, k: Konfig): void {
  // Gzip/Brotli für alles ab 1 KB; index.html schrumpft um rund 80 %.
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        // SSE-Ströme NICHT komprimieren — sie müssen sofort hinaus. includes() statt
        // Gleichheit, weil OkHttp `text/event-stream, */*` schickt.
        if (String(req.headers.accept || '').includes('text/event-stream')) return false;
        if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Handgerollt statt helmet: keine zusätzliche Abhängigkeit, und die CSP muss
  // ohnehin auf die App zugeschnitten sein.
  app.use(securityHeaders(k.hstsMaxAge, k.production));

  // Das Konto der Anfrage für Zähler tief unten (src/externalSources/apiQuota.ts).
  app.use(rememberRequest);

  // Sonst glaubt Express X-Forwarded-Proto nie und setzt kein secure-Cookie (src/infra/proxyVertrauen.ts).
  if (k.operation) {
    app.set('trust proxy', proxyVertrauen(k.trustProxy, k.proxyNetworkConfirmed));
  }
  // Auch ausserhalb der Produktion: Er meldet ein verworfenes X-Forwarded-For.
  app.locals.proxyHinweis = proxyHinweis(k.trustProxy, console.warn, Date.now, k.proxyNetworkConfirmed);
  app.use(app.locals.proxyHinweis);

  // `//api/…` fiele sonst bis zum SPA-Catch-all durch und bekäme index.html mit 200.
  app.use((req, _res, next) => {
    if (req.url.startsWith('//') || req.url.includes('//', 1)) {
      const [pathTeil, ...rest] = req.url.split('?');
      const pathPart = pathTeil ?? '';
      const cleaned = pathPart.replace(/\/{2,}/g, '/');
      if (cleaned !== pathPart) req.url = cleaned + (rest.length ? '?' + rest.join('?') : '');
    }
    next();
  });

  app.use(onlyOwnHost);
  // Vor der Herkunftsprüfung: Browser schicken CSP-Berichte ohne verlässliche Herkunft.
  app.use(buildCspReportRouter());
  app.use(onlyOwnOrigin);
  // no-store als Vorgabe: Antworten tragen Konten, Gutscheine und Tokens. Was bewusst
  // gecacht wird (img-proxy, Design), setzt seinen Kopf selbst und überschreibt ihn.
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

  // Eine Kennung je Anfrage für ihre Logzeilen; die des Proxys nur, wenn sie src/infra/protokoll.ts besteht.
  app.use((req, res, next) => {
    const rid = anfrageKennung(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', rid);
    requestContext.run({ rid }, () => next());
  });
}

const securityHeaders =
  (hstsAlter: number, production: boolean) =>
  (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    // Kein fremdes Fenster hält einen Griff auf die App, keine fremde Seite bettet ihre Antworten ein.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // HSTS nur über TLS. req.secure, weil Express X-Forwarded-Proto nur von einem
    // vertrauten Proxy übernimmt; den rohen Kopf kann jeder Client schicken.
    const viaTls = req.secure;
    // hstsAlter: Vorgabe ein Jahr, 0 schaltet ab.
    if (viaTls && hstsAlter !== 0) {
      res.setHeader('Strict-Transport-Security', `max-age=${hstsAlter}; includeSubDomains`);
    }

    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // Ohne 'unsafe-inline': Alle Handler laufen über js/aktionen.js.
        "script-src 'self'",
        // Stile setzt js/styles.js per CSSOM; inline nur das Startgerüst, per Hash.
        `style-src 'self'${startPageStyleHash(production) ? ' ' + startPageStyleHash(production) : ''}`,
        "font-src 'self'",
        // Ohne https:: Fremde Bilder gehen durch den Bild-Proxy, und ein eingeschleustes
        // <img src="https://fremd/?daten"> wäre sonst ein Kanal nach draussen.
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:", // PDF.js-Worker (lokal /vendor/pdfjs, ggf. blob:)
        "frame-ancestors 'self'", // eigener PDF-Viewer bettet same-origin PDFs per <iframe> ein
        // default-src deckt diese drei nicht ab: Formular nach draussen, <base> zum
        // Umlenken, <object>/<embed> für Plugins.
        "form-action 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        // Markup nur über setzeHtml() (Richtlinie app); `default` lässt nur eigene Skript-Adressen durch.
        "require-trusted-types-for 'script'",
        'trusted-types app default',
        'report-uri /csp-bericht',
        'report-to csp',
      ].join('; '),
    );
    res.setHeader('Reporting-Endpoints', 'csp="/csp-bericht"');
    next();
  };

function sessionInPostgres(pool: Pool, geheimnis: string, k: Konfig): RequestHandler {
  // In PostgreSQL, damit Sitzungen einen Neustart überleben; die Tabelle legt das Schema an.
  const PgSession = connectPgSimple(session);
  const sessionStorage = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15,
    // Nach Stunden Leerlauf endet eine Webapp-Sitzung.
    ttl: sessionIdleSec(k),
    errorLog: err => {
      if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
        console.error('[session-store]', err.message);
      }
    },
  });

  // Gedrosselt geschrieben (src/konto/sitzungsBeruehrung.ts).
  touchThrottle(sessionStorage, touchMs(sessionIdleMs(k)));

  return session({
    store: sessionStorage,
    secret: geheimnis,
    resave: false,
    saveUninitialized: false,
    name: sitzungsKeksName(),
    cookie: sessionCookieOptions(),
  });
}

function sitzung(app: express.Express, speicher: RequestHandler, konto: AccountServices, k: Konfig): void {
  app.use(speicher);
  app.use(checkSessionVersion(konto));
  app.use(sessionMaxDuration(sitzungsfristen(k)));
}

function filesAndImages(app: express.Express, d: Dienste, konfig: Konfig): void {
  app.use(buildDataFilesRouter(d));
  app.use(buildCertificateRouter());
  app.use(buildWellKnownRouter(konfig));
  registerImgProxy(app, d);

  app.use(buildPagesRouter(d));
  app.use(
    express.static(PUBLIC_DIR, {
      // `/` goes through the renderer (src/profile/indexHtml.ts), not as a file.
      index: false,
      // Gestempelte Assets (?v=) lange cachen; index.html no-cache, damit Deploys sofort gelten.
      maxAge: '7d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
}

function apiRoutes(app: express.Express, d: Dienste): void {
  const check = checkContract();
  if (check) app.use('/api/v1', check);
  // Express fände `/vouchers/1/klartext/` unter `/vouchers/:id/klartext`, alles davor (Drossel,
  // Schrittschutz, Caddy) sieht einen anderen Pfad. Mit `/` am Ende kennt der Vertrag nur `/api/v1/`.
  app.use('/api', (req, res, next) =>
    req.path !== '/v1/' && req.path.length > 1 && req.path.endsWith('/') ? unknownApiPath(req, res) : next(),
  );
  // Vor dem Eingang: Gefragt wird, bevor Schema, Migrationen und /api/v1-Router stehen.
  app.use('/api/v1', buildGesundheitRouter(d));
  apiInbox(app, d);
  app.use('/api/v1', buildApiRouter(d));
  app.use('/api/v1/auth', buildAuthRouter(d));
}

/** Der Eingang vor allen /api/v1-Routern. */
function apiInbox(app: express.Express, d: Dienste): void {
  // EIN Eingang: loginAtInbox verlangt Sitzung oder Token für alles unter
  // /api/v1 ausser den ausdrücklich öffentlichen Pfaden. Der Schutz je Route
  // bleibt als zweite Linie.
  app.use('/api/v1', guardFor(d.konto).loginAtInbox);
  // Danach das Budget je Konto, VOR dem Rumpf: Eine abgewiesene Anfrage soll
  // ihren Rumpf nicht mehr lesen (src/http/apiDrossel.ts).
  app.use('/api/v1', apiDrossel);
  // Heikle Schritte eines App-Tokens erst nach der Gerätesperre (src/konto/http/schrittschutz.ts).
  app.use('/api/v1', stepChutzAtInbox(d.konto));
  // Rümpfe erst nach der Anmeldung lesen: Unangemeldet gibt es nur 16 KB (readBody).
  app.use('/api/v1', readBody);
  app.use('/api/v1', idempotency(d.idempotency));
}

function fallbacks(app: express.Express, profile: ProfileServices): void {
  // VOR dem SPA-Catch-all: Sonst bekäme ein Tippfehler im API-Pfad die
  // index.html mit 200. Ohne Rücksicht auf die Schreibung, die Routen davor achten darauf.
  app.use((req, res, next) => (/^\/api(\/|$)/i.test(req.path) ? unknownApiPath(req, res) : next()));

  // '{*splat}' statt '/*splat': Express 5 verlangt einen Namen, und die
  // naheliegende Form träfe die Startseite `/` nicht.
  app.get('/{*splat}', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    await sendStartPage(profile, res, req.session?.userId);
  });

  // Der eine Fehlerweg aller Router: Ein Fehler überspringt alles ohne Fehlerparameter
  // bis hierher; die Router selbst hängen keinen eigenen an.
  app.use(errorResponse);
}
