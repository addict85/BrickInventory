/** Die Express-App: Middleware, Sitzung, Dateien und Router in ihrer Reihenfolge.
 * server.ts startet nur; Tests bauen dieselbe App (test/helpers/server.js). */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import type { Pool } from 'pg';
import type { Konfig } from '../src/infra/konfig';
import { anfrageKontext, anfrageKennung } from '../src/infra/protokoll';
import { fehlerAntwort, unbekannterApiPfad } from '../src/http/httpAntwort';
import { sitzungsKeksName, sitzungsKeksOptionen } from '../src/http/sitzungsKeks';
import { drossleBeruehren, SITZUNG_LEERLAUF_SEK, sitzungsHoechstdauer, startStilHash } from '../src/konto';
import { sitzungsVersionPruefen } from '../src/konto/http/sitzungsPruefung';
import type { KontoDienste } from '../src/konto';
import { merkeAnfrage } from '../src/http/kontoMerken';
import { proxyVertrauen } from '../src/infra/proxyVertrauen';
import { proxyHinweis } from '../src/http/proxyHinweis';
import { nurEigeneHerkunft, nurEigenerHost } from '../src/http/herkunft';
import { API_VERSION, API_MIN_APP, appFassungPruefen } from '../src/http/apiVersion';
import { PUBLIC_DIR } from '../src/infra/appPaths';
import { sendeStartseite } from '../src/konto/http/startseite';
import { registerImgProxy } from '../routes/imgProxy';
import { waechterFuer, rumpfLesen } from '../routes/api_v1/middleware';
import { schrittschutzAmEingang } from '../src/konto/http/schrittschutz';
import { apiDrossel } from '../src/http/apiDrossel';
import { idempotenz } from '../src/idempotenz/http/middleware';
import { baueDatenDateienRouter } from '../routes/datenDateien';
import { baueApiRouter } from '../routes/api_v1/index';
import { baueAuthRouter } from '../routes/auth';
import zertifikatRouter from '../routes/zertifikat';
import cspBerichtRouter from '../src/http/cspBericht';
import wellKnownRouter from '../routes/wellKnown';
import { baueGesundheitRouter } from '../routes/gesundheit';
import { baueSeitenRouter } from '../routes/seiten';
import { vertragPruefen } from '../src/http/vertragsRouter';
import type { Dienste } from './verdrahtung';

export interface AppZutaten {
  /** Für den Sitzungsspeicher (user_sessions). */
  pool: Pool;
  konfig: Konfig;
  /** Geprüft in server.ts: Ein Platzhalter beendet dort den Start. */
  sitzungsGeheimnis: string;
  /** Die Routen bekommen ihre Dienste von hier (startup/verdrahtung.ts, baueDienste). */
  dienste: Dienste;
  /** Setzt req.session; ohne Angabe express-session über user_sessions. Ein Test stellt
   * hier seine Sitzung, die Prüfungen danach (Version, Höchstdauer) bleiben die echten. */
  sitzungsSpeicher?: RequestHandler;
}

/** Die Abschnitte stehen in der Reihenfolge der Middleware. */
export function baueApp({ pool, konfig, sitzungsGeheimnis, dienste, sitzungsSpeicher }: AppZutaten): express.Express {
  const app = express();
  // Verrät nur, womit der Server gebaut ist — wer sucht, soll es nicht geschenkt bekommen.
  app.disable('x-powered-by');
  // Vor dem ersten app.use: Ein /API/… träfe sonst dieselbe Route, aber keinen Vertragseintrag.
  app.set('case sensitive routing', true);
  grundschutz(app, konfig);
  sitzung(app, sitzungsSpeicher ?? sitzungInPostgres(pool, sitzungsGeheimnis), dienste.konto);
  dateienUndBilder(app, dienste);
  apiRouten(app, dienste);
  rueckfaelle(app, dienste.konto);
  return app;
}

function grundschutz(app: express.Express, k: Konfig): void {
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
  app.use(sicherheitsKoepfe(k.hstsMaxAge));

  // Das Konto der Anfrage für Zähler tief unten (src/fremdquellen/apiKontingent.ts).
  app.use(merkeAnfrage);

  // Sonst glaubt Express X-Forwarded-Proto nie und setzt kein secure-Cookie (src/infra/proxyVertrauen.ts).
  if (k.betrieb) {
    app.set('trust proxy', proxyVertrauen(k.trustProxy));
  }
  // Auch ausserhalb der Produktion: Er meldet ein verworfenes X-Forwarded-For.
  app.locals.proxyHinweis = proxyHinweis(k.trustProxy);
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

  app.use(nurEigenerHost);
  // Vor der Herkunftsprüfung: Browser schicken CSP-Berichte ohne verlässliche Herkunft.
  app.use(cspBerichtRouter);
  app.use(nurEigeneHerkunft);
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
    appFassungPruefen,
  );

  // Eine Kennung je Anfrage für ihre Logzeilen; die des Proxys nur, wenn sie src/infra/protokoll.ts besteht.
  app.use((req, res, next) => {
    const rid = anfrageKennung(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', rid);
    anfrageKontext.run({ rid }, () => next());
  });
}

const sicherheitsKoepfe =
  (hstsAlter: number) =>
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
    const ueberTls = req.secure;
    // hstsAlter: Vorgabe ein Jahr, 0 schaltet ab.
    if (ueberTls && hstsAlter !== 0) {
      res.setHeader('Strict-Transport-Security', `max-age=${hstsAlter}; includeSubDomains`);
    }

    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // Ohne 'unsafe-inline': Alle Handler laufen über js/actions.js.
        "script-src 'self'",
        // Stile setzt js/stile.js per CSSOM; inline nur das Startgerüst, per Hash.
        `style-src 'self'${startStilHash() ? ' ' + startStilHash() : ''}`,
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

function sitzungInPostgres(pool: Pool, geheimnis: string): RequestHandler {
  // In PostgreSQL, damit Sitzungen einen Neustart überleben; die Tabelle legt das Schema an.
  const PgSession = connectPgSimple(session);
  const sitzungsSpeicher = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15,
    // Nach Stunden Leerlauf endet eine Webapp-Sitzung.
    ttl: SITZUNG_LEERLAUF_SEK,
    errorLog: err => {
      if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
        console.error('[session-store]', err.message);
      }
    },
  });

  // Gedrosselt geschrieben (src/konto/sitzungsBeruehrung.ts).
  drossleBeruehren(sitzungsSpeicher);

  return session({
    store: sitzungsSpeicher,
    secret: geheimnis,
    resave: false,
    saveUninitialized: false,
    name: sitzungsKeksName(),
    cookie: sitzungsKeksOptionen(),
  });
}

function sitzung(app: express.Express, speicher: RequestHandler, konto: KontoDienste): void {
  app.use(speicher);
  app.use(sitzungsVersionPruefen(konto));
  app.use(sitzungsHoechstdauer());
}

function dateienUndBilder(app: express.Express, d: Dienste): void {
  app.use(baueDatenDateienRouter(d));
  app.use(zertifikatRouter);
  app.use(wellKnownRouter);
  registerImgProxy(app, d);

  app.use(baueSeitenRouter(d));
  app.use(
    express.static(PUBLIC_DIR, {
      // `/` geht über den Renderer (src/konto/indexHtml.ts), nicht als Datei.
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

function apiRouten(app: express.Express, d: Dienste): void {
  const pruefung = vertragPruefen();
  if (pruefung) app.use('/api/v1', pruefung);
  // Vor dem Eingang: Gefragt wird, bevor Schema, Migrationen und /api/v1-Router stehen.
  app.use('/api/v1', baueGesundheitRouter(d));
  apiEingang(app, d);
  app.use('/api/v1', baueApiRouter(d));
  app.use('/api/v1/auth', baueAuthRouter(d));
}

/** Der Eingang vor allen /api/v1-Routern. */
function apiEingang(app: express.Express, d: Dienste): void {
  // EIN Eingang: anmeldungAmEingang verlangt Sitzung oder Token für alles unter
  // /api/v1 ausser den ausdrücklich öffentlichen Pfaden. Der Schutz je Route
  // bleibt als zweite Linie.
  app.use('/api/v1', waechterFuer(d.konto).anmeldungAmEingang);
  // Danach das Budget je Konto, VOR dem Rumpf: Eine abgewiesene Anfrage soll
  // ihren Rumpf nicht mehr lesen (src/http/apiDrossel.ts).
  app.use('/api/v1', apiDrossel);
  // Heikle Schritte eines App-Tokens erst nach der Gerätesperre (src/konto/http/schrittschutz.ts).
  app.use('/api/v1', schrittschutzAmEingang(d.konto));
  // Rümpfe erst nach der Anmeldung lesen: Unangemeldet gibt es nur 16 KB (rumpfLesen).
  app.use('/api/v1', rumpfLesen);
  app.use('/api/v1', idempotenz(d.idempotenz));
}

function rueckfaelle(app: express.Express, konto: KontoDienste): void {
  // VOR dem SPA-Catch-all: Sonst bekäme ein Tippfehler im API-Pfad die
  // index.html mit 200. Ohne Rücksicht auf die Schreibung, die Routen davor achten darauf.
  app.use((req, res, next) => (/^\/api(\/|$)/i.test(req.path) ? unbekannterApiPfad(req, res) : next()));

  // '{*splat}' statt '/*splat': Express 5 verlangt einen Namen, und die
  // naheliegende Form träfe die Startseite `/` nicht.
  app.get('/{*splat}', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    await sendeStartseite(konto, res, req.session?.userId);
  });

  // Für Fehler, die an den Route-Catches vorbeikommen: loggt voll, antwortet generisch.
  app.use(fehlerAntwort);
}
