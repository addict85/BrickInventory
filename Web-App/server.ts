import type { Request, Response, NextFunction } from 'express';
// Zuerst: Ein ungültiger Wert beendet den Start mit Meldung, bevor ein Modul ihn liest.
import { konfig } from './startup/konfigPruefen';
// Protokoll zuerst: Ab hier ist jede console-Zeile eine JSON-Zeile und geht
// nach app_logs, sobald der Pool steht.
import { installiereProtokoll, protokollInDieDatenbank, leereProtokoll, anfrageKontext, anfrageKennung } from './src/infra/protokoll';
installiereProtokoll();

import fs from 'fs';
import http, { type Server } from 'http';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import * as db from './db/database';
import { fehlertext, logAndContinue, meldeUndWeiter, meldeUndLiefere } from './src/infra/fehler';
import { fehlerAntwort, unbekannterApiPfad } from './src/infra/httpAntwort';
import { fehlerText, antwortSprache } from './src/infra/fehlerTexte';
import { startVerbote, startWarnungen } from './src/infra/konfig';
import { hinweisOhneBasisUrl } from './src/infra/basisUrl';
import { sitzungsKeksName, sitzungsKeksOptionen } from './src/infra/sitzungsKeks';
import { bereiteDatenbankVor } from './startup/datenbank';
import { starteJobs, stoppeJobs } from './startup/jobsProzess';
import { verdrahte } from './jobs/verdrahtung';
import { drossleBeruehren } from './src/konto/sitzungsBeruehrung';
import { SITZUNG_LEERLAUF_SEK, sitzungsHoechstdauer } from './src/konto/sitzungsFrist';
import { sitzungsVersionPruefen } from './src/konto/http/sitzungsPruefung';
import { antwortAufDateiFehler, liefereDatei, sendeDatei } from './src/infra/dateiAusliefern';
import { cdnFuerFehlendesBild } from './src/katalog/bilder/bildNachschlagen';
import { bildFreigegeben } from './src/katalog/bilder/bildBlickfeld';
import { aktuellerStartZustand, oeffentlicherStartZustand } from './src/auftraege/startZustand';
import { merkeAnfrage } from './src/infra/anfrageKonto';
import { proxyVertrauen, proxyHinweis } from './src/infra/proxyVertrauen';
import { nurEigeneHerkunft, nurEigenerHost } from './src/infra/herkunft';
import { API_VERSION, API_MIN_APP, appFassungPruefen } from './src/infra/apiVersion';
import { resolveUserId, istVerwalter } from './src/konto/http/anmeldung';
import { PUBLIC_DIR } from './src/infra/appPaths';
import { IMG_PROXY_PFAD } from './src/katalog/bilder/images';
import { safeDataPath } from './src/infra/datenPfad';
import { generateThumb } from './src/katalog/bilder/thumbs';
import { closeAllSse } from './src/infra/sseRegistry';
import { renderIndexHtml, startStilHash } from './src/konto/indexHtml';
import { meldeSmtpAltlast } from './src/mail/mailer';
import { meldeUngueltigeAdressen, meldeAusstehendeAdressen } from './src/konto/konten';
import { horcheAufTokenWiderruf } from './src/konto/auth';
import * as pgNotify from './db/pgNotify';
import { registerImgProxy } from './routes/imgProxy';
import { anmeldungAmEingang, rumpfLesen } from './routes/api_v1/middleware';
import { idempotenz } from './src/idempotenz/http/middleware';
import { vertragPruefen } from './src/infra/vertrag/pruefen';
import datenDateien = require('./routes/datenDateien');
import apiV1Router = require('./routes/api_v1/index');
import authRouter = require('./routes/auth');
import zertifikatRouter = require('./routes/zertifikat');
import wellKnownRouter = require('./routes/wellKnown');

/** Mit benanntem `params`, sonst wäre der erfasste Pfad implizit `any`. */
type WildcardRequest = Request<{ pfad: string[] }>;

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', fehlertext(reason));
});
process.on('uncaughtException', (err) => {
  // Der Zustand ist danach ungewiss (halb offene Transaktionen); den Neustart übernimmt Docker.
  console.error('[uncaughtException] Uncaught exception:', err.stack || err.message);
  void leereProtokoll();
  setTimeout(() => process.exit(1), 500).unref();
});

// Die Platzhalter aus compose.yaml/README sind öffentlich: Mit ihnen
// signierte Sitzungen könnte jeder selbst erzeugen.
const PLATZHALTER_GEHEIMNISSE = [
  'change-me-to-a-long-random-string',
  'hier-langen-zufalls-string-eintragen',
  'brickinventory-manager-dev-secret',
];

/** Das Entwicklungsgeheimnis nur bei ausdrücklichem NODE_ENV=development/test;
 * ohne NODE_ENV gelten dieselben Regeln wie in Produktion. */
function sitzungsGeheimnis(): string {
  const gesetzt = konfig().sessionSecret?.trim();
  if (konfig().entwicklung) return gesetzt || 'brickinventory-manager-dev-secret';
  const grund = !gesetzt ? 'SESSION_SECRET ist nicht gesetzt — Start verweigert. Bitte in compose.yaml/ENV setzen'
      + (konfig().produktion ? '.' : ', oder für die Entwicklung NODE_ENV=development.')
    : PLATZHALTER_GEHEIMNISSE.includes(gesetzt) ? 'SESSION_SECRET steht noch auf dem Beispielwert aus compose.yaml — Start verweigert. Bitte einen eigenen Zufallswert eintragen, z. B. `openssl rand -base64 48`.'
    : gesetzt.length < 32 ? `SESSION_SECRET ist zu kurz (${gesetzt.length} Zeichen, nötig sind mindestens 32) — Start verweigert.`
    : null;
  if (grund) { console.error(`❌ [session] ${grund}`); process.exit(1); }
  return konfig().sessionSecret!;
}

/** Die Abschnitte stehen in der Reihenfolge der Middleware. */
function baueApp(): express.Express {
  const app = express();
  // Verrät nur, womit der Server gebaut ist — wer sucht, soll es nicht geschenkt bekommen.
  app.disable('x-powered-by');
  // Vor dem ersten app.use: Ein /API/… träfe sonst dieselbe Route, aber keinen Vertragseintrag.
  app.set('case sensitive routing', true);
  grundschutz(app);
  sitzung(app);
  dateienUndBilder(app);
  apiRouten(app);
  rueckfaelle(app);
  return app;
}

function grundschutz(app: express.Express): void {
  // Gzip/Brotli für alles ab 1 KB; index.html schrumpft um rund 80 %.
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      // SSE-Ströme NICHT komprimieren — sie müssen sofort hinaus. includes() statt
      // Gleichheit, weil OkHttp `text/event-stream, */*` schickt.
      if (String(req.headers.accept || '').includes('text/event-stream')) return false;
      if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
      return compression.filter(req, res);
    }
  }));

  // Handgerollt statt helmet: keine zusätzliche Abhängigkeit, und die CSP muss
  // ohnehin auf die App zugeschnitten sein.
  app.use(sicherheitsKoepfe);

  // Das Konto der Anfrage für Zähler tief unten (src/katalog/apiKontingent.ts).
  app.use(merkeAnfrage);

  // Sonst glaubt Express X-Forwarded-Proto nie und setzt kein secure-Cookie (src/infra/proxyVertrauen.ts).
  if (konfig().produktion) {
    app.set('trust proxy', proxyVertrauen(konfig().trustProxy));
  }
  // Auch ausserhalb der Produktion: Er meldet ein verworfenes X-Forwarded-For.
  app.use(proxyHinweis(konfig().trustProxy));

  // `//api/…` fiele sonst bis zum SPA-Catch-all durch und bekäme index.html mit 200.
  // Ausführlich: docs/begruendungen/server.ts.md#abschnitt-3
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
  app.use(nurEigeneHerkunft);
  // no-store als Vorgabe: Antworten tragen Konten, Gutscheine und Tokens. Was bewusst
  // gecacht wird (img-proxy, Design), setzt seinen Kopf selbst und überschreibt ihn.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Api-Version', String(API_VERSION));
    res.setHeader('X-Api-Min-App', String(API_MIN_APP));
    next();
  }, appFassungPruefen);

  // Eine Kennung je Anfrage für ihre Logzeilen; die des Proxys nur, wenn sie src/infra/protokoll.ts besteht.
  app.use((req, res, next) => {
    const rid = anfrageKennung(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', rid);
    anfrageKontext.run({ rid }, () => next());
  });

}

function sicherheitsKoepfe(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  // Kein fremdes Fenster hält einen Griff auf die App, keine fremde Seite bettet ihre Antworten ein.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // HSTS nur über TLS. req.secure, weil Express X-Forwarded-Proto nur von einem
  // vertrauten Proxy übernimmt; den rohen Kopf kann jeder Client schicken.
  // Ausführlich: docs/begruendungen/server.ts.md#port-uebertls
  const ueberTls = req.secure;
  const hstsAlter = konfig().hstsMaxAge;   // Vorgabe ein Jahr, 0 schaltet ab
  if (ueberTls && hstsAlter !== 0) {
    res.setHeader('Strict-Transport-Security', `max-age=${hstsAlter}; includeSubDomains`);
  }

  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Ohne 'unsafe-inline': Alle Handler laufen über js/11-actions.js.
    "script-src 'self'",
    // Stile setzt js/00-stile.js per CSSOM; inline nur das Startgerüst, per Hash.
    `style-src 'self'${startStilHash() ? ' ' + startStilHash() : ''}`,
    "font-src 'self'",
    // Ohne https:: Fremde Bilder gehen durch den Bild-Proxy, und ein eingeschleustes
    // <img src="https://fremd/?daten"> wäre sonst ein Kanal nach draussen.
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",  // PDF.js-Worker (lokal /vendor/pdfjs, ggf. blob:)
    "frame-ancestors 'self'",  // eigener PDF-Viewer bettet same-origin PDFs per <iframe> ein
    // default-src deckt diese drei nicht ab: Formular nach draussen, <base> zum
    // Umlenken, <object>/<embed> für Plugins.
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '));
  next();
}

function sitzung(app: express.Express): void {
  // In PostgreSQL, damit Sitzungen einen Neustart überleben; die Tabelle legt das Schema an.
  const PgSession = connectPgSimple(session);
  const sitzungsSpeicher = new PgSession({
    pool: db.pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15,
    // Nach ein paar Stunden Leerlauf endet eine Webapp-Sitzung.
    // Ausführlich: docs/begruendungen/server.ts.md#sitzungsspeicher
    ttl: SITZUNG_LEERLAUF_SEK,
    errorLog: (err) => {
      if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
        console.error('[session-store]', err.message);
      }
    },
  });

  // Gedrosselt geschrieben (src/konto/sitzungsBeruehrung.ts).
  drossleBeruehren(sitzungsSpeicher);

  app.use(session({
    store: sitzungsSpeicher,
    secret: sitzungsGeheimnis(),
    resave: false,
    saveUninitialized: false,
    name: sitzungsKeksName(),
    cookie: sitzungsKeksOptionen(),
  }));
  app.use(sitzungsVersionPruefen());
  app.use(sitzungsHoechstdauer());
}

function dateienUndBilder(app: express.Express): void {
  app.use(datenDateien);
  app.use(zertifikatRouter);
  app.use(wellKnownRouter);
  registerImgProxy(app);

  // EINE authentifizierte Route für alle Bilder: Eigene Uploads dürfen nicht
  // ohne Anmeldung hinaus.
  // Ausführlich: docs/begruendungen/server.ts.md#abschnitt-4
  app.get('/images/*pfad', liefereBild);
  app.use(express.static(PUBLIC_DIR, {
    // `/` geht über den Renderer (src/konto/indexHtml.ts), nicht als Datei.
    index: false,
    // Gestempelte Assets (?v=) lange cachen; index.html no-cache, damit Deploys sofort gelten.
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

}

async function liefereBild(req: WildcardRequest, res: Response) {
  const imgUserId = await resolveUserId(req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');

  const segments = req.params.pfad.filter(Boolean);
  const filePath = safeDataPath('images', segments);
  // Fremdes Set-Bild wie fehlendes: 404, sonst verriete die Antwort den Bestand.
  if (!filePath || !await bildFreigegeben(imgUserId, segments).catch(meldeUndLiefere('bilder:blickfeld', false)))
    return res.status(404).send('Datei nicht gefunden');

  // private: Die Antwort hängt an einer Anmeldung und darf nicht in einen
  // geteilten Zwischenspeicher. max-age=0, damit ein ersetztes Bild sofort gilt.
  // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage
  res.setHeader('Cache-Control', 'private, max-age=0');

  sendeDatei(res, filePath, async err => {
    if (!err || res.headersSent) return;

    // Ein Fehler MIT eigener Zahl (416, 403) ist keine fehlende Datei: Die
    // Ausweichwege unten suchten eine andere Datei und verdeckten die Ursache.
    if ((err as { status?: number }).status && (err as { status?: number }).status !== 404) {
      return antwortAufDateiFehler(res, err);
    }

    // Fehlt die Vorschau, geht sofort das Original hinaus, statt auf sie zu warten.
    const rohPfad = segments.join('/');
    const thumbTreffer = /_thumb(\.[^.]+)$/.exec(rohPfad);
    if (thumbTreffer) {
      const originalSegs = rohPfad.replace(/_thumb(\.[^.]+)$/, '$1').split('/').filter(Boolean);
      const originalPfad = safeDataPath('images', originalSegs);
      if (originalPfad && fs.existsSync(originalPfad)) {
        // Nachziehen: Scheiterte sie beim Erfassen, gäbe es sonst keinen zweiten Anlauf.
        // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage-webpfadoriginal
        const webPfadOriginal = '/images/' + originalSegs.join('/');
        setImmediate(() => {
          try { generateThumb(webPfadOriginal).catch(logAndContinue('server:generateThumb')); }
          catch (e) { meldeUndWeiter('server:vorschau-erzeugen', e); }
        });
        return liefereDatei(res, originalPfad);
      }
    }

    // Fehlt die Datei, über den Bild-Proxy zur CDN-Adresse: heilt ohne Aufräumen in der DB.
    const webPath = '/images/' + segments.join('/');
    const cdn = await cdnFuerFehlendesBild(webPath);
    if (cdn && !res.headersSent) {
      return res.redirect(302, IMG_PROXY_PFAD + '?url=' + encodeURIComponent(cdn));
    }
    antwortAufDateiFehler(res, err);
  });
}

function apiRouten(app: express.Express): void {
  app.use('/api/v1', vertragPruefen);
  // Direkt hier: Gefragt wird, bevor Schema, Migrationen und /api/v1-Router stehen.
  app.get('/api/v1/startup-status', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const angemeldet = !!(await resolveUserId(req).catch(logAndContinue('startup-status:anmeldung')));
    res.json(oeffentlicherStartZustand(await aktuellerStartZustand(), angemeldet));
  });

  // Ohne Anmeldung (compose.yaml): anonym nur der Status; live = Prozess, ready = Datenbank.
  app.get('/api/v1/health/live', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/api/v1/health/ready', async (req, res) => {
    if (await db.datenbankAntwortet()) return void res.json({ status: 'ok' });
    res.status(503).json({ success: false, code: 'datenbank_nicht_erreichbar', status: 'unavailable',
      error: fehlerText('datenbank_nicht_erreichbar', antwortSprache(req)) });
  });
  app.get('/api/v1/health', async (req, res) => {
    // Klemmt die Datenbank, bleibt der Bericht erreichbar — nur ohne Details.
    const verwalter = !!(await resolveUserId(req).catch(logAndContinue('health:anmeldung'))) && istVerwalter(req);
    const start = await aktuellerStartZustand();
    res.json({
      status: start.ready ? 'ok' : 'starting',
      ...(verwalter ? { startup: start, db_pool: db.getPoolStats(), uptime_seconds: Math.floor(process.uptime()) } : {}),
    });
  });

  // EIN Eingang: anmeldungAmEingang verlangt Sitzung oder Token für alles unter
  // /api/v1 ausser den ausdrücklich öffentlichen Pfaden. Der Schutz je Route
  // bleibt als zweite Linie.
  // Ausführlich: docs/begruendungen/server.ts.md#abschnitt-7
  app.use('/api/v1',          anmeldungAmEingang);
  // Rümpfe erst nach der Anmeldung lesen: Unangemeldet gibt es nur 16 KB (rumpfLesen).
  app.use('/api/v1',          rumpfLesen);
  app.use('/api/v1',          idempotenz);
  app.use('/api/v1',          apiV1Router);
  app.use('/api/v1/auth',     authRouter);
}

function rueckfaelle(app: express.Express): void {
  // Links aus einer E-Mail: Erst ein Knopf auf der Seite wirkt (POST), sonst
  // bestätigte schon der Link-Scanner des Mailanbieters eine fremde Adresse.
  app.get(['/verify', '/reset-password'], async (_req, res) => {
    // Renderer statt sendFile, sonst gingen die Assets ohne Stempel hinaus.
    res.set('Cache-Control', 'no-store');
    try {
      res.type('html').send(await renderIndexHtml());
    } catch {
      res.sendFile('index.html', { root: PUBLIC_DIR });
    }
  });

  // VOR dem SPA-Catch-all: Sonst bekäme ein Tippfehler im API-Pfad die
  // index.html mit 200. Ohne Rücksicht auf die Schreibung, die Routen davor achten darauf.
  app.use((req, res, next) => /^\/api(\/|$)/i.test(req.path) ? unbekannterApiPfad(req, res) : next());

  // '{*splat}' statt '/*splat': Express 5 verlangt einen Namen, und die
  // naheliegende Form träfe die Startseite `/` nicht.
  // Ausführlich: docs/begruendungen/server.ts.md#abschnitt-8
  app.get('/{*splat}', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    try {
      res.type('html').send(await renderIndexHtml(req.session?.userId));
    } catch {
      // Fällt das Rendern aus, geht die Datei unverändert hinaus; js/00-theme-boot.js übernimmt.
      res.sendFile('index.html', { root: PUBLIC_DIR });
    }
  });

  // Für Fehler, die an den Route-Catches vorbeikommen: loggt voll, antwortet generisch.
  app.use(fehlerAntwort);
}

/** SSE-Ströme zuerst beenden: Sie enden nie von selbst und hielten close() auf.
 * Ohne geordnetes Ende bräche jedes Deploy laufende Antworten ab.
 * Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-shutdown-timeout-ms */
const SHUTDOWN_TIMEOUT_MS = 8000;
let _beendetWird = false;

async function herunterfahren(signal: string, httpServer: Server | null, jobs: boolean): Promise<void> {
  if (_beendetWird) return;
  _beendetWird = true;
  console.log(`[shutdown] ${signal} empfangen — Server wird geordnet beendet`);
  // Notbremse für eine hängende Verbindung; Exit-Code 0, denn sie ist kein Fehler.
  const notbremse = setTimeout(() => {
    console.warn('[shutdown] Frist abgelaufen — Beenden wird erzwungen');
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  notbremse.unref();
  try {
    if (httpServer) {
      const beendet = closeAllSse();
      if (beendet) console.log(`[shutdown] ${beendet} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
    }
    // Laufende Aufträge halten sicher an und gehen zurück in die Tabelle.
    if (jobs) await stoppeJobs();
    await pgNotify.close().catch(logAndContinue('server:close'));
    await db.pool.end().catch(logAndContinue('server:end'));
    console.log('[shutdown] Datenbankverbindungen geschlossen');
    clearTimeout(notbremse);
    process.exit(0);
  } catch (e) {
    console.error('[shutdown] Fehler beim Beenden:', fehlertext(e));
    process.exit(1);
  }
}

/** Ein Prozess je Rolle (ROLLE=web|jobs|beides); initSchemaOnce lässt nur einen migrieren. */
async function starte(): Promise<void> {
  const k = konfig();
  if (k.produktion) {
    const verbote = startVerbote();
    if (verbote.length) { for (const v of verbote) console.error(`❌ ${v}`); process.exit(1); }
    for (const w of startWarnungen()) console.warn(`⚠️ ${w}`);
  }
  for (const v of k.veraltet) console.warn(`⚠️ [start] ${v} wird nicht mehr ausgewertet und kann weg (siehe UPGRADE.md).`);
  if (!k.appBaseUrl) hinweisOhneBasisUrl('start', 'Mails enthalten keine Links (Bestätigung, Passwort vergessen), Passkeys und QR-Code der App sind aus.');
  const web = k.rolle !== 'jobs', jobs = k.rolle !== 'web';
  if (!k.appBaseUrl && k.produktion && web) console.error('❌ [start] APP_BASE_URL fehlt im Betrieb (APP_BASE_URL_FEHLT_OK=1): '
    + 'Der Host-Filter gegen DNS-Rebinding ist aus, jede Webseite im Heimnetz erreicht die Anmeldung.');
  if (web) sitzungsGeheimnis();   // vor der Datenbank: Ein Startverbot soll nicht auf sie warten
  console.log(`[start] Prozess ${process.pid}, Rolle ${k.rolle}`);
  // Erfassungen und Einstellungen stossen ihre Nacharbeit in jedem Prozess an.
  verdrahte();

  try { await bereiteDatenbankVor(); }
  catch (e) {
    console.error('❌ Database initialisation failed:', fehlertext(e));
    console.error('   Check PostgreSQL connection settings (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
    process.exit(1);
  }
  protokollInDieDatenbank(db.pool);
  if (web) await meldeSmtpAltlast().catch(logAndContinue('start:smtp-altlast'));
  if (web) await meldeUngueltigeAdressen().catch(logAndContinue('start:adressen'));
  if (web) await meldeAusstehendeAdressen().catch(logAndContinue('start:ausstehende-adressen'));
  if (web) horcheAufTokenWiderruf();

  // Erst nach dem Schema Anfragen annehmen: Der Sitzungsspeicher braucht user_sessions.
  // Fünf Minuten für 50-MB-Uploads; ohne kurzes Prüfintervall griffe die Kopffrist erst nach 45 s.
  const fristen = { headersTimeout: 15_000, requestTimeout: 300_000, connectionsCheckingInterval: 1_000 };
  const httpServer = web ? http.createServer(fristen, baueApp()).listen(k.port, () => {
    console.log(`🧱 BrickInventory Manager — http://localhost:${k.port}`);
  }) : null;
  process.on('SIGTERM', () => { void herunterfahren('SIGTERM', httpServer, jobs); });
  process.on('SIGINT',  () => { void herunterfahren('SIGINT', httpServer, jobs); });
  if (jobs) await starteJobs(web);
}

void starte();
