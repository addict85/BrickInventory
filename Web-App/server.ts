import type { Request, Response } from 'express';
// Zuerst: Ein ungültiger Wert beendet den Start mit Meldung, bevor ein Modul ihn liest.
import { konfig } from './startup/konfigPruefen';
// Protokoll zuerst: Ab hier ist jede console-Zeile eine JSON-Zeile und geht
// nach app_logs, sobald der Pool steht.
import { installiereProtokoll, protokollInDieDatenbank, leereProtokoll, anfrageKontext, anfrageKennung } from './src/infra/protokoll';
installiereProtokoll();

import fs from 'fs';
import type { Server } from 'http';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import * as db from './db/database';
import { fehlertext, logAndContinue, meldeUndWeiter, fehlerAntwort } from './src/infra/httpError';
import { startVerbote } from './src/infra/konfig';
import { sitzungsKeksName, sitzungsKeksOptionen } from './src/infra/sitzungsKeks';
import { bereiteDatenbankVor } from './startup/datenbank';
import { starteJobs, stoppeJobs } from './startup/jobsProzess';
import { verdrahte } from './jobs/verdrahtung';
import { drossleBeruehren } from './src/konto/sitzungsBeruehrung';
import { SITZUNG_LEERLAUF_SEK, sitzungsHoechstdauer } from './src/konto/sitzungsFrist';
import { antwortAufDateiFehler, liefereDatei, sendeDatei } from './src/infra/dateiAusliefern';
import { cdnFuerFehlendesBild } from './src/katalog/bilder/bildNachschlagen';
import { aktuellerStartZustand, oeffentlicherStartZustand } from './src/infra/startZustand';
import { merkeAnfrage } from './src/infra/anfrageKonto';
import { proxyVertrauen, proxyHinweis } from './src/infra/proxyVertrauen';
import { nurEigeneHerkunft } from './src/infra/herkunft';
import { API_VERSION, API_MIN_APP, appFassungPruefen } from './src/infra/apiVersion';
import { verifiziereEmailToken } from './src/konto/auth';
import { resolveUserId, istVerwalter } from './src/konto/http/anmeldung';
import { PUBLIC_DIR } from './src/infra/appPaths';
import { IMG_PROXY_PFAD } from './src/katalog/bilder/images';
import { safeDataPath } from './src/infra/datenPfad';
import { generateThumb } from './src/katalog/bilder/thumbs';
import { closeAllSse } from './src/infra/sseRegistry';
import { renderIndexHtml } from './src/konto/indexHtml';
import { meldeSmtpAltlast } from './src/infra/mailer';
import * as pgNotify from './db/pgNotify';
import { registerImgProxy } from './routes/imgProxy';
import { anmeldungAmEingang } from './routes/api_v1/middleware';
import { idempotenz } from './src/idempotenz/http/middleware';
import { vertragPruefen } from './src/infra/vertrag/pruefen';
import datenDateien = require('./routes/datenDateien');
import apiV1Router = require('./routes/api_v1/index');
import authRouter = require('./routes/auth');
import zertifikatRouter = require('./routes/zertifikat');
import wellKnownRouter = require('./routes/wellKnown');

/** Benannt, weil `params` auf dem allgemeinen Request-Typ leer ist und der
 * erfasste Pfad sonst ein implizites `any`. */
type WildcardRequest = Request<{ pfad: string[] }>;

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', fehlertext(reason));
});
process.on('uncaughtException', (err) => {
  // Danach ist der Prozesszustand ungewiss (halb offene Transaktionen):
  // beenden; den Neustart übernimmt Docker (restart: unless-stopped).
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

function sitzungsGeheimnis(): string {
  const gesetzt = konfig().sessionSecret?.trim();
  if (!konfig().produktion) return gesetzt || 'brickinventory-manager-dev-secret';
  const grund = !gesetzt ? 'SESSION_SECRET ist nicht gesetzt — Start verweigert. Bitte in compose.yaml/ENV setzen.'
    : PLATZHALTER_GEHEIMNISSE.includes(gesetzt) ? 'SESSION_SECRET steht noch auf dem Beispielwert aus compose.yaml — Start verweigert. Bitte einen eigenen Zufallswert eintragen, z. B. `openssl rand -base64 48`.'
    : gesetzt.length < 32 ? `SESSION_SECRET ist zu kurz (${gesetzt.length} Zeichen, nötig sind mindestens 32) — Start verweigert.`
    : null;
  if (grund) { console.error(`❌ [session] ${grund}`); process.exit(1); }
  return konfig().sessionSecret!;
}

function baueApp(): express.Express {
const app  = express();
// Verrät nur, womit der Server gebaut ist — wer sucht, soll es nicht geschenkt bekommen.
app.disable('x-powered-by');

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

// ── Security-Header ───────────────────────────────────────────────────────────
// Handgerollt statt helmet: keine zusätzliche Abhängigkeit, und die CSP muss
// ohnehin auf die App zugeschnitten sein.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  // Kein fremdes Fenster hält einen Griff auf die App, keine fremde Seite bettet ihre Antworten ein.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // HSTS nur über eine verschlüsselte Verbindung; danach geht auch die erste
  // getippte Anfrage nicht mehr samt Cookie im Klartext hinaus.
  // Ausführlich: docs/begruendungen/server.ts.md#port-uebertls
  const ueberTls = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const hstsAlter = konfig().hstsMaxAge;   // Vorgabe ein Jahr, 0 schaltet ab
  if (ueberTls && hstsAlter !== 0) {
    res.setHeader('Strict-Transport-Security', `max-age=${hstsAlter}; includeSubDomains`);
  }

  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // Ohne 'unsafe-inline': Alle Handler laufen über den Dispatcher in
    // js/11-actions.js, die CSP ist damit eine echte zweite Verteidigungslinie.
    "script-src 'self'",
    // Stile setzt js/00-stile.js per CSSOM, das die CSP nicht betrifft.
    "style-src 'self'",
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
});

// 256 KB: Ein grosses Limit überall liesse jeden Client den Heap füllen. Die
// PDF-Routen setzen ihr eigenes.
app.use(express.json({ limit: '256kb' }));
// Das Konto der Anfrage für Zähler tief unten (src/katalog/apiKontingent.ts).
app.use(merkeAnfrage);
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

/** Express 5 lässt `req.body` ohne Parser `undefined`; die Routen verlassen
 * sich auf ein Objekt. */
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Hinter einem TLS-terminierenden Proxy muss Express X-Forwarded-Proto
// glauben, sonst setzt es das secure-Cookie nie (src/infra/proxyVertrauen.ts).
if (konfig().produktion) {
  app.set('trust proxy', proxyVertrauen(konfig().trustProxy));
}
// Auch ausserhalb der Produktion: Dort wird X-Forwarded-For ohne Vertrauen
// verworfen, und genau das meldet er.
app.use(proxyHinweis(konfig().trustProxy));

// Doppelte Schrägstriche zusammenfassen: `//api/…` fiele sonst bis zum
// SPA-Catch-all durch und bekäme index.html mit Status 200.
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

app.use(nurEigeneHerkunft);
app.use('/api', (_req, res, next) => {
  res.setHeader('X-Api-Version', String(API_VERSION));
  res.setHeader('X-Api-Min-App', String(API_MIN_APP));
  next();
}, appFassungPruefen);

// Eine kurze Kennung je Anfrage für alle ihre Logzeilen; die des Proxys nur,
// wenn sie die Prüfung in src/infra/protokoll.ts besteht.
app.use((req, res, next) => {
  const rid = anfrageKennung(req.headers['x-request-id']);
  res.setHeader('X-Request-Id', rid);
  anfrageKontext.run({ rid }, () => next());
});

// In PostgreSQL, damit Sitzungen einen Neustart überleben. Die Tabelle legt
// das Schema an, bevor der Server Anfragen annimmt.
const PgSession = connectPgSimple(session);
const sitzungsSpeicher = new PgSession({
  pool: db.pool,
  tableName: 'user_sessions',
  createTableIfMissing: false,
  pruneSessionInterval: 60 * 15,
  // Webapp-Sitzungen sollen nach ein paar Stunden Leerlauf enden; die Vorgabe
  // der Bibliothek (ein Tag) war nie eine Entscheidung.
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
app.use(sitzungsHoechstdauer());

app.use(datenDateien);
app.use(zertifikatRouter);
app.use(wellKnownRouter);
registerImgProxy(app);

// EINE authentifizierte Route für alle Bilder: Eigene Uploads dürfen nicht
// ohne Anmeldung hinaus.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-4
app.get('/images/*pfad', async (req: WildcardRequest, res: Response) => {
  const imgUserId = await resolveUserId(req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');

  const segments = req.params.pfad.filter(Boolean);
  const filePath = safeDataPath('images', segments);
  if (!filePath) return res.status(404).send('Datei nicht gefunden');

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

    // Fehlt eine Vorschau, geht das danebenliegende Original sofort hinaus,
    // statt auf die Erzeugung zu warten.
    const rohPfad = segments.join('/');
    const thumbTreffer = /_thumb(\.[^.]+)$/.exec(rohPfad);
    if (thumbTreffer) {
      const originalSegs = rohPfad.replace(/_thumb(\.[^.]+)$/, '$1').split('/').filter(Boolean);
      const originalPfad = safeDataPath('images', originalSegs);
      if (originalPfad && fs.existsSync(originalPfad)) {
        // Die Vorschau im Hintergrund nachziehen: Scheiterte sie beim Erfassen, gäbe
        // es sonst keinen zweiten Anlauf.
        // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage-webpfadoriginal
        const webPfadOriginal = '/images/' + originalSegs.join('/');
        setImmediate(() => {
          try { generateThumb(webPfadOriginal).catch(logAndContinue('server:generateThumb')); }
          catch (e) { meldeUndWeiter('server:vorschau-erzeugen', e); }
        });
        return liefereDatei(res, originalPfad);
      }
    }

    // Lokale Datei fehlt → über den Bild-Proxy zur CDN-Adresse aus dem Katalog.
    // Heilt Web und Android ohne Aufräumen in der Datenbank.
    const webPath = '/images/' + segments.join('/');
    const cdn = await cdnFuerFehlendesBild(webPath);
    if (cdn && !res.headersSent) {
      return res.redirect(302, IMG_PROXY_PFAD + '?url=' + encodeURIComponent(cdn));
    }
    antwortAufDateiFehler(res, err);
  });
});

app.use(express.static(PUBLIC_DIR, {
  // `index: false`: Sonst lieferte express.static die index.html für `/`
  // selbst aus, am Renderer (src/konto/indexHtml.ts) vorbei.
  index: false,
  // Assets mit ?v=-Stempel dürfen lange gecacht werden; index.html bekommt
  // no-cache, damit Deploys sofort sichtbar sind.
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Direkt hier statt in einem Router: Beide werden gefragt, während Schema und
// Migrationen noch laufen und der /api/v1-Router noch nicht steht.

app.use('/api/v1', vertragPruefen);
app.get('/api/v1/startup-status', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json(oeffentlicherStartZustand(await aktuellerStartZustand()));
});

// Ohne Anmeldung (compose.yaml): anonym nur der Status; live = Prozess, ready = Datenbank.
app.get('/api/v1/health/live', (_req, res) => { res.json({ status: 'ok' }); });
app.get('/api/v1/health/ready', async (_req, res) => {
  const bereit = await db.datenbankAntwortet();
  res.status(bereit ? 200 : 503).json({ status: bereit ? 'ok' : 'unavailable' });
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
app.use('/api/v1',          idempotenz);
app.use('/api/v1',          apiV1Router);
app.use('/api/v1/auth',     authRouter);

// Der Link kommt aus einer E-Mail: Die Antwort ist eine Seite, kein JSON.
app.get('/verify', async (req, res) => {
  try {
    const e = await verifiziereEmailToken(req.query.token);
    res.redirect(e.ok ? '/?verified=1' : '/?verified=invalid');
  } catch (e) {
    // Dem Klickenden keine Fehlerseite — er kann nichts damit anfangen. Ins
    // Protokoll gehört der Fehler trotzdem.
    console.error('Verify error:', fehlertext(e));
    res.redirect('/?verified=invalid');
  }
});

// Ausdrücklich, damit location.pathname === '/reset-password' stimmt.
app.get('/reset-password', async (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  // Über den Renderer statt sendFile: sonst gingen die Assets ohne Stempel
  // und im Standarddesign hinaus.
  try {
    res.type('html').send(await renderIndexHtml());
  } catch {
    res.sendFile('index.html', { root: PUBLIC_DIR });
  }
});

// VOR dem SPA-Catch-all: Sonst bekäme ein Tippfehler im API-Pfad die
// index.html mit 200, und die App meldete einen Serialisierungsfehler.
app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Endpoint nicht gefunden' }));

// '{*splat}' statt '/*splat': Express 5 verlangt einen Namen, und die
// naheliegende Form träfe die Startseite `/` nicht.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-8
app.get('/{*splat}', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    res.type('html').send(await renderIndexHtml(req.session?.userId));
  } catch {
    // Fällt das Rendern aus, geht die Datei unverändert hinaus —
    // js/00-theme-boot.js übernimmt dann.
    res.sendFile('index.html', { root: PUBLIC_DIR });
  }
});

// Für Fehler, die an den Route-Catches vorbeikommen: loggt voll, antwortet generisch.
app.use(fehlerAntwort);
return app;
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
    // Laufende Aufträge halten an einer sicheren Stelle an und gehen zurück
    // in die Tabelle; der nächste Start setzt sie fort.
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

/** Ein Prozess je Rolle (ROLLE=web|jobs|beides). Beide migrieren; die Sperre
 * in initSchemaOnce lässt genau einen arbeiten. */
async function starte(): Promise<void> {
  const k = konfig();
  if (k.produktion) {
    const verbote = startVerbote();
    if (verbote.length) { for (const v of verbote) console.error(`❌ ${v}`); process.exit(1); }
  }
  for (const v of k.veraltet) console.warn(`⚠️ [start] ${v} wird nicht mehr ausgewertet und kann weg (siehe UPGRADE.md).`);
  const web = k.rolle !== 'jobs', jobs = k.rolle !== 'web';
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

  // Erst nach dem Schema Anfragen annehmen: Der Sitzungsspeicher braucht user_sessions.
  const httpServer = web ? baueApp().listen(k.port, () => {
    console.log(`🧱 BrickInventory Manager — http://localhost:${k.port}`);
  }) : null;
  process.on('SIGTERM', () => { void herunterfahren('SIGTERM', httpServer, jobs); });
  process.on('SIGINT',  () => { void herunterfahren('SIGINT', httpServer, jobs); });
  if (jobs) await starteJobs(web);
}

void starte();
