import type { Request, Response } from 'express';
// Zuerst: Ein ungültiger Wert beendet den Start mit Meldung, bevor ein Modul ihn liest.
import { konfig } from './startup/konfigPruefen';
// Protokoll zuerst: Ab hier ist jede console-Zeile eine JSON-Zeile auf
// stdout/stderr und geht nach app_logs, sobald der Pool steht.
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
import { startVerbote, cookieSicher } from './src/infra/konfig';
import { bereiteDatenbankVor } from './startup/datenbank';
import { starteJobs, stoppeJobs } from './startup/jobsProzess';
import { verdrahte } from './jobs/verdrahtung';
import { drossleBeruehren } from './src/konto/sitzungsBeruehrung';
import { SITZUNG_LEERLAUF_SEK, sitzungsHoechstdauer } from './src/konto/sitzungsFrist';
import { antwortAufDateiFehler, liefereDatei, sendeDatei } from './src/infra/dateiAusliefern';
import { cdnFuerFehlendesBild } from './src/katalog/bilder/bildNachschlagen';
import { aktuellerStartZustand } from './src/infra/startZustand';
import { merkeAnfrage } from './src/infra/anfrageKonto';
import { proxyVertrauen, proxyHinweis } from './src/infra/proxyVertrauen';
import { nurEigeneHerkunft } from './src/infra/herkunft';
import { API_VERSION, API_MIN_APP, appFassungPruefen } from './src/infra/apiVersion';
import { resolveUserId, istVerwalter, verifiziereEmailToken } from './src/konto/auth';
import { PUBLIC_DIR } from './src/infra/appPaths';
import { IMG_PROXY_PFAD } from './src/katalog/bilder/images';
import { safeDataPath } from './src/infra/datenPfad';
import { generateThumb } from './src/katalog/bilder/thumbs';
import { closeAllSse } from './src/infra/sseRegistry';
import { renderIndexHtml } from './src/konto/indexHtml';
import * as pgNotify from './db/pgNotify';
import { registerImgProxy } from './routes/imgProxy';
import { anmeldungAmEingang } from './routes/api_v1/middleware';
import datenDateien = require('./routes/datenDateien');
import apiV1Router = require('./routes/api_v1/index');
import authRouter = require('./routes/auth');
import zertifikatRouter = require('./routes/zertifikat');

/**
 * Anfrage einer Wildcard-Route (`app.get('/images/*pfad', …)`).
 * Ausführlich: docs/begruendungen/server.ts.md#wildcardrequest
 */
type WildcardRequest = Request<{ pfad: string[] }>;

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', fehlertext(reason));
});
process.on('uncaughtException', (err) => {
  // Danach ist der Prozesszustand ungewiss (halb offene Transaktionen):
  // Protokoll leeren und beenden; den Neustart übernimmt Docker (restart: unless-stopped).
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

/** Das Sitzungsgeheimnis; in Produktion beendet ein fehlendes oder schwaches den Start. */
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

/** Die Express-Anwendung — nur der Web-Prozess baut sie. */
function baueApp(): express.Express {
const app  = express();
// Verrät nur, womit der Server gebaut ist — wer sucht, soll es nicht geschenkt bekommen.
app.disable('x-powered-by');

// Gzip/Brotli für alles ab 1 KB; index.html schrumpft um rund 80 %.
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    // SSE-Ströme NICHT komprimieren — sie müssen sofort rausgehen.
    // Ausführlich: docs/begruendungen/server.ts.md#port
    if (String(req.headers.accept || '').includes('text/event-stream')) return false;
    if (String(res.getHeader('Content-Type') || '').includes('text/event-stream')) return false;
    return compression.filter(req, res);
  }
}));

// ── Security-Header ───────────────────────────────────────────────────────────
// Handgerollt statt helmet: keine zusätzliche Dependency, und die CSP muss
// ohnehin auf die App zugeschnitten sein. Weder Skript noch Stil dürfen inline
// stehen; daneben schützen die Header gegen fremdes Framing (same-origin ist
// für den eigenen PDF-Viewer erlaubt), MIME-Sniffing und fremde Quellen.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS, aber NUR über eine verschlüsselte Verbindung
  // Ohne diesen Kopf geht die allererste Anfrage nach einem getippten
  // "lego.bigolin.online" im Klartext hinaus — samt Cookie, wenn
  // COOKIE_SECURE nicht gesetzt ist. Die Umleitung auf https kommt erst als …
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
    // Ausführlich: docs/begruendungen/server.ts.md#port-2
    "script-src 'self'",
    // Schriften liegen unter public/vendor/fonts/; Stile setzt js/00-stile.js
    // per CSSOM, das die CSP nicht betrifft.
    "style-src 'self'",
    "font-src 'self'",
    // Ohne https:: Jede fremde Bildadresse geht durch den Bild-Proxy, und ein
    // eingeschleustes <img src="https://fremd/?daten"> wäre sonst ein Kanal nach draussen.
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",  // PDF.js-Worker (lokal /vendor/pdfjs, ggf. blob:)
    "frame-ancestors 'self'",  // eigener PDF-Viewer bettet same-origin PDFs per <iframe> ein
    // Drei Wege, die default-src nicht abdeckt: Ein eingeschleustes Formular
    // schickte Eingaben nach draussen, ein <base> lenkte relative Adressen um,
    // <object>/<embed> lüden Plugins. Die App braucht keinen davon fremd.
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; '));
  next();
});

// Body-Grenze 256 KB: Ein grosses Limit überall liesse jeden Client mit ein
// paar Anfragen den Heap füllen. Die PDF-Routen setzen ihr eigenes
// (routes/api_v1/pdf.ts).
app.use(express.json({ limit: '256kb' }));
// Das Konto der Anfrage für Zähler tief unten (src/katalog/apiKontingent.ts).
app.use(merkeAnfrage);
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

/**
 * `req.body` ist immer ein Objekt — die Zusicherung von Express 4, nachgebaut.
 * Ausführlich: docs/begruendungen/server.ts.md#abschnitt-2
 */
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Hinter einem TLS-terminierenden Reverse-Proxy muss Express X-Forwarded-Proto
// glauben, sonst setzt es das secure-Cookie nie. Wem genau: src/infra/proxyVertrauen.ts.
if (konfig().produktion) {
  app.set('trust proxy', proxyVertrauen(konfig().trustProxy));
}
// Der Hinweis gilt immer: Ohne Vertrauen wird X-Forwarded-For auch ausserhalb
// der Produktion verworfen, und genau das meldet er.
app.use(proxyHinweis(konfig().trustProxy));

// Doppelte Schrägstriche im Pfad zusammenfassen
// `//api/img-proxy?url=…` trifft in Express NICHT auf `/api/img-proxy`. Die
// Anfrage fällt stattdessen durch bis zum SPA-Catch-all und bekommt
// index.html — mit **Status 200** und `text/html`. Im Browser ist das eine …
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

// Jede Anfrage bekommt eine kurze Kennung für alle ihre Logzeilen; die des
// Proxys nur, wenn sie die Prüfung in src/infra/protokoll.ts besteht.
app.use((req, res, next) => {
  const rid = anfrageKennung(req.headers['x-request-id']);
  res.setHeader('X-Request-Id', rid);
  anfrageKontext.run({ rid }, () => next());
});

// Sitzungen in PostgreSQL: Sie überleben einen Neustart des Web-Prozesses.
// Die Tabelle legt das Schema an (createTableIfMissing: false), bevor der Server Anfragen annimmt.
const PgSession = connectPgSimple(session);
const sitzungsSpeicher = new PgSession({
  pool: db.pool,
  tableName: 'user_sessions',
  createTableIfMissing: false,
  pruneSessionInterval: 60 * 15,
  // Die Leerlauf-Frist der Webapp-Sitzung; die Vorgabe der Bibliothek (ein Tag) war nie eine Entscheidung.
  // Ausführlich: docs/begruendungen/server.ts.md#sitzungsspeicher
  ttl: SITZUNG_LEERLAUF_SEK,
  errorLog: (err) => {
    if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
      console.error('[session-store]', err.message);
    }
  },
});

// Die Ablaufzeit der Sitzung wird gedrosselt geschrieben — die Messung und die
// Begruendung stehen in src/konto/sitzungsBeruehrung.ts.
drossleBeruehren(sitzungsSpeicher);

app.use(session({
  store: sitzungsSpeicher,
  secret: sitzungsGeheimnis(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Ohne maxAge ein Sitzungscookie: endet mit dem Browser. httpOnly hält
    // Skripte fern, sameSite schützt vor CSRF.
    httpOnly: true,
    sameSite: 'lax',
    // Cookie nur über HTTPS senden. Default: in Produktion aktiv; per
    // COOKIE_SECURE=0 abschaltbar, falls (ausnahmsweise) ohne TLS betrieben.
    secure: cookieSicher(konfig()),
  }
}));
app.use(sitzungsHoechstdauer());

// Eigene und geteilte Anleitungen unter /data/ — samt Pfad- und Besitzerprüfung.
app.use(datenDateien);
// Wurzelzertifikat der internen CA (öffentlich, routes/zertifikat.ts).
app.use(zertifikatRouter);
registerImgProxy(app);

// Alle Bilder: Sets, Teile, Minifiguren
// EINE authentifizierte Route für den gesamten Baum unter data/images/.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-4
app.get('/images/*pfad', async (req: WildcardRequest, res: Response) => {
  // Session ODER Bearer-Token (Android) — läuft über den gemeinsamen Token-Cache
  const imgUserId = await resolveUserId(req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');

  const segments = req.params.pfad.filter(Boolean);
  const filePath = safeDataPath('images', segments);
  if (!filePath) return res.status(404).send('Datei nicht gefunden');

  // Privat, nicht public: Die Antwort hängt an einer Anmeldung und darf nicht
  // in einem geteilten Zwischenspeicher (Reverse-Proxy, CDN) landen.
  // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage
  res.setHeader('Cache-Control', 'private, max-age=0');

  sendeDatei(res, filePath, async err => {
    if (!err || res.headersSent) return;

    // Ein Fehler MIT eigener Zahl (416, 403) ist keine fehlende Datei: Die
    // Ausweichwege unten suchen eine ANDERE Datei und verdeckten die Ursache.
    if ((err as { status?: number }).status && (err as { status?: number }).status !== 404) {
      return antwortAufDateiFehler(res, err);
    }

    // Fehlt eine Vorschau, liegt fast immer das Original daneben: Das geht
    // sofort hinaus, statt auf die Erzeugung der Vorschau zu warten.
    // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage-rohpfad
    const rohPfad = segments.join('/');
    const thumbTreffer = /_thumb(\.[^.]+)$/.exec(rohPfad);
    if (thumbTreffer) {
      const originalSegs = rohPfad.replace(/_thumb(\.[^.]+)$/, '$1').split('/').filter(Boolean);
      const originalPfad = safeDataPath('images', originalSegs);
      if (originalPfad && fs.existsSync(originalPfad)) {
        // Fehlende Vorschau im HINTERGRUND nachziehen.
        // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage-webpfadoriginal
        const webPfadOriginal = '/images/' + originalSegs.join('/');
        setImmediate(() => {
          try { generateThumb(webPfadOriginal).catch(logAndContinue('server:generateThumb')); }
          catch (e) { meldeUndWeiter('server:vorschau-erzeugen', e); }
        });
        return liefereDatei(res, originalPfad);
      }
    }

    // Lokale Datei fehlt -> über den Bild-Proxy zur CDN-Adresse aus dem
    // Katalog umleiten. Heilt Web und Android ohne Aufräumen in der Datenbank.
    const webPath = '/images/' + segments.join('/');
    const cdn = await cdnFuerFehlendesBild(webPath);
    if (cdn && !res.headersSent) {
      return res.redirect(302, IMG_PROXY_PFAD + '?url=' + encodeURIComponent(cdn));
    }
    antwortAufDateiFehler(res, err);
  });
});

// Kein express.static für /images mehr.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-5

app.use(express.static(PUBLIC_DIR, {
  // `index: false`: Sonst lieferte express.static die index.html für `/`
  // selbst aus, am Renderer (src/konto/indexHtml.ts) vorbei.
  // Ausführlich: docs/begruendungen/server.ts.md#lookupcdnformissingimage-2
  index: false,
  // Assets (Bilder, SVG, CSS/JS mit ?v=-Cache-Busting) dürfen lange gecacht werden.
  // index.html bekommt no-cache, damit Deploys sofort sichtbar sind — die
  // versionierten Referenzen darin ziehen dann frische Assets nach.
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Die zwei Adressen, die VOR allem anderen antworten muessen
// Sie stehen hier direkt und nicht in einem Router: Beide werden auch gefragt,
// während der Job-Prozess den Katalog noch lädt.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-6

// Startzustand — ohne Anmeldung, wird VOR dem Login gebraucht.
app.get('/api/v1/startup-status', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json(await aktuellerStartZustand());
});

// Gesundheitscheck samt Verbindungspool — ohne Anmeldung (compose.yaml).
// Der Startzustand ist öffentlich (der Ladebildschirm vor der Anmeldung
// braucht ihn); Pool und Laufzeit verraten Last und Neustarts — nur für den
// Verwalter.
app.get('/api/v1/health', async (req, res) => {
  // Klemmt die Datenbank, bleibt der Bericht trotzdem erreichbar — nur ohne Details.
  const verwalter = !!(await resolveUserId(req).catch(logAndContinue('health:anmeldung'))) && istVerwalter(req);
  const start = await aktuellerStartZustand();
  res.json({
    status: start.ready ? 'ok' : 'starting',
    startup: start,
    ...(verwalter ? { db_pool: db.getPoolStats(), uptime_seconds: Math.floor(process.uptime()) } : {}),
  });
});

// EIN Adressraum mit EINEM Eingang: anmeldungAmEingang verlangt Sitzung oder
// Token für alles unter /api/v1 ausser den ausdrücklich öffentlichen Pfaden.
// Der Schutz je Route bleibt als zweite Linie und kostet keinen zweiten Abruf.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-7
app.use('/api/v1',          anmeldungAmEingang);
app.use('/api/v1',          apiV1Router);
app.use('/api/v1/auth',     authRouter);

// ── E-Mail Bestätigung: /verify?token=... ─────────────────────────────────────
// Der Link kommt aus einer E-Mail: Die Antwort ist eine Seite, kein JSON.
app.get('/verify', async (req, res) => {
  try {
    const e = await verifiziereEmailToken(req.query.token);
    res.redirect(e.ok ? '/?verified=1' : '/?verified=invalid');
  } catch (e) {
    // Ein Datenbankfehler darf dem Klickenden keine Fehlerseite zeigen — er
    // kann nichts damit anfangen. Ins Protokoll gehört er trotzdem.
    console.error('Verify error:', fehlertext(e));
    res.redirect('/?verified=invalid');
  }
});

// ── Passwort zurücksetzen: /reset-password?token=... ──────────────────────────
// Explizit registriert damit location.pathname === '/reset-password' stimmt.
app.get('/reset-password', async (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  // Über den Renderer statt sendFile: sonst gingen die Assets ohne Stempel
  // (src/infra/assetStempel.ts) und im Standarddesign hinaus.
  try {
    res.type('html').send(await renderIndexHtml());
  } catch {
    res.sendFile('index.html', { root: PUBLIC_DIR });
  }
});

// ── 404 für unbekannte API-Pfade ────────────────────────────────────────────
// VOR dem SPA-Catch-all: Sonst bekäme ein Tippfehler im API-Pfad die
// index.html mit 200, und die App meldete einen Serialisierungsfehler.
app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Endpoint nicht gefunden' }));

// Die Schreibweise mit den geschweiften Klammern ist NICHT Geschmack.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-8
app.get('/{*splat}', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    // data-theme und die Sprachdatei setzt der Renderer (src/konto/indexHtml.ts);
    // ohne Sitzung gilt die Vorgabe.
    res.type('html').send(await renderIndexHtml(req.session?.userId));
  } catch {
    // Fällt das Rendern aus, bleibt die Datei unverändert ausgeliefert —
    // js/00-theme-boot.js übernimmt dann wie bisher.
    res.sendFile('index.html', { root: PUBLIC_DIR });
  }
});

// Fängt synchron geworfene Fehler und next(err)-Aufrufe, die an den
// Route-Catches vorbeikommen — loggt voll, antwortet generisch.
app.use(fehlerAntwort);
return app;
}

/**
 * Geordnetes Herunterfahren: SSE-Ströme beenden (sie enden nie von selbst und
 * hielten close() auf), HTTP schliessen, laufende Aufträge zurückgeben, Pool zu.
 * Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-shutdown-timeout-ms
 */
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

/**
 * Ein Prozess je Rolle (ROLLE=web|jobs|beides). Beide migrieren beim Start;
 * die Sperre in initSchemaOnce lässt genau einen arbeiten.
 */
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

  // Erst nach dem Schema Anfragen annehmen: Der Sitzungsspeicher braucht user_sessions.
  const httpServer = web ? baueApp().listen(k.port, () => {
    console.log(`🧱 BrickInventory Manager — http://localhost:${k.port}`);
  }) : null;
  process.on('SIGTERM', () => { void herunterfahren('SIGTERM', httpServer, jobs); });
  process.on('SIGINT',  () => { void herunterfahren('SIGINT', httpServer, jobs); });
  if (jobs) await starteJobs(web);
}

void starte();
