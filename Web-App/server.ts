import type { Request, Response, NextFunction } from 'express';
// Zuerst: Ein ungültiger Wert beendet den Start mit Meldung, bevor ein Modul ihn liest.
import { konfig } from './startup/konfigPruefen';

/**
 * Anfrage einer Wildcard-Route (`app.get('/images/*pfad', …)`).
 * Ausführlich: docs/begruendungen/server.ts.md#wildcardrequest
 */
type WildcardRequest = Request<{ pfad: string[] }>;
// ── Log interceptor — write console output to PostgreSQL app_logs ─────────────
// Must be first so all subsequent logs are captured
const _logBuffer: { level: string; message: string }[] = [];
let   _logPool: import('pg').Pool | null = null;
let   _logTimer: NodeJS.Timeout | null = null;

function _flushLogs() {
  if (!_logPool || !_logBuffer.length) return;
  const rows = _logBuffer.splice(0);
  const vals = rows.map((_, i) => `($${i*2+1},$${i*2+2})`).join(',');
  const args = rows.flatMap(r => [r.level, r.message]);
  _logPool.query(`INSERT INTO app_logs (level,message) VALUES ${vals}`, args).catch(() => {});
}
// Log-Cleanup läuft planbar alle 6h statt zufällig im Flush-Pfad
setInterval(() => {
  if (_logPool)
    _logPool.query(`DELETE FROM app_logs WHERE logged_at < NOW() - INTERVAL '48 hours'`).catch(() => {});
}, 6 * 60 * 60 * 1000).unref();
function _safeStringify(a: unknown) {
  if (typeof a === 'string') return a;
  try {
    const s = JSON.stringify(a);
    // Grosse Objekte kappen, bevor sie durch Buffer und DB wandern
    return s && s.length > 4000 ? s.substring(0, 4000) + '…' : (s ?? String(a));
  } catch (_) { return String(a); }
}
/**
 * Ablaufkontext der gerade bearbeiteten Anfrage.
 * Ausführlich: docs/begruendungen/server.ts.md#abschnitt
 */
const { AsyncLocalStorage } = require('async_hooks');
const _reqContext = new AsyncLocalStorage();

/** Kurze Prozesskennung, damit im Log erkennbar ist, welcher Worker schrieb. */
const _pidTag = String(process.pid).slice(-4);

function _intercept(level: string, orig: (...a: unknown[]) => void) {
  return function(...args: unknown[]) {
    const ctx = _reqContext.getStore();
    const prefix = ctx?.rid ? `[${_pidTag}/${ctx.rid}] ` : `[${_pidTag}] `;
    orig.apply(console, [prefix + _safeStringify(args[0]), ...args.slice(1)]);
    const msg = prefix + args.map(_safeStringify).join(' ');
    _logBuffer.push({ level, message: msg.substring(0, 4000) });
    // Ohne Pool (Start, Datenbank weg) wüchse der Puffer unbegrenzt. Es
    // bleiben die neuesten 500; jede Zeile steht ohnehin schon auf
    // stdout/stderr (orig.apply oben), also auch die erste eines Fehlersturms.
    if (_logBuffer.length > 500) _logBuffer.splice(0, _logBuffer.length - 500);
    if (_logTimer) clearTimeout(_logTimer);
    _logTimer = setTimeout(() => { _logTimer = null; _flushLogs(); }, 1500);
  };
}
console.log   = _intercept('info',  console.log);
console.info  = _intercept('info',  console.info);
console.warn  = _intercept('warn',  console.warn);
console.error = _intercept('error', console.error);
/** Ab hier gehen die Protokollzeilen auch nach app_logs (sobald der Pool steht). */
function protokollInDieDatenbank(pool: import('pg').Pool) { _logPool = pool; _flushLogs(); }

// Prevent worker crashes from unhandled promise rejections
// Log them instead of crashing the process
process.on('unhandledRejection', (reason: unknown, _promise) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', fehlertext(reason));
});
process.on('uncaughtException', (err) => {
  // Nach einer uncaught Exception ist der Prozesszustand potenziell korrupt
  // (halb offene Transaktionen, hängende Handles). Loggen, Logs flushen und
  // kontrolliert beenden — der Cluster-Primary forkt sofort einen Ersatz-Worker.
  console.error('[uncaughtException] Uncaught exception:', err.stack || err.message);
  try { _flushLogs(); } catch (_) {}
  setTimeout(() => process.exit(1), 500).unref();
});


// ── Cluster: fork one worker per CPU so multiple requests run in parallel ─────
import { fehlertext, logAndContinue, meldeUndWeiter } from './utils/httpError';
import cluster from 'cluster';
import { starteHintergrundlaeufe } from './startup/backgroundJobs';
import { bereiteDatenbankVor } from './startup/datenbank';
import { verdrahte } from './jobs/verdrahtung';
import { stoppeAuftragsWorker } from './jobs/auftraegeStarten';

// In JEDEM Prozess: Erfassungen und Einstellungen stossen ihre Nacharbeit
// auch in den Web-Workern an, nicht nur im Primary.
verdrahte();
import { HAUSHALT_KANAL, leereHaushaltCache } from './utils/household';
import { drossleBeruehren } from './utils/sitzungsBeruehrung';
import { SITZUNG_LEERLAUF_SEK, sitzungsHoechstdauer } from './utils/sitzungsFrist';
import { antwortAufDateiFehler, liefereDatei, sendeDatei } from './utils/dateiAusliefern';
import { liesZustand, loescheZustand } from './utils/laufzustand';
import { cdnFuerFehlendesBild } from './utils/bildNachschlagen';
import { startZustand, setzeStartZustand } from './utils/startZustand';

const WORKERS = (require('./utils/workerZahl') as typeof import('./utils/workerZahl')).workerZahl();

if (cluster.isPrimary && konfig().produktion) {
  console.log(`[cluster] Primary ${process.pid} starting ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  const { neustartPause } = require('./utils/workerZahl') as typeof import('./utils/workerZahl');
  const abstuerze: number[] = [];
  // Docker schickt SIGTERM nur an PID 1, also an diesen Prozess. Ohne
  // Weitergabe liefen die Shutdown-Handler der Worker nie, und nach der Frist
  // folgte SIGKILL mitten in Anfragen und Importen.
  let beendetWird = false;
  const beendeAlle = (signal: NodeJS.Signals) => {
    if (beendetWird) return;
    beendetWird = true;
    console.log(`[cluster] ${signal} — Worker werden geordnet beendet`);
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(signal);
    // Etwas länger als die Frist der Worker (SHUTDOWN_TIMEOUT_MS).
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => beendeAlle('SIGTERM'));
  process.on('SIGINT', () => beendeAlle('SIGINT'));
  cluster.on('exit', (worker, code) => {
    if (beendetWird) {
      if (!Object.keys(cluster.workers ?? {}).length) process.exit(0);
      return;
    }
    if (code !== 0) {
      const jetzt = Date.now();
      abstuerze.push(jetzt);
      while (abstuerze.length && jetzt - abstuerze[0]! > 60_000) abstuerze.shift();
      const pause = neustartPause(abstuerze.length);
      console.warn(`[cluster] Worker ${worker.process.pid} died (code ${code}) — Neustart in ${pause / 1000} s`);
      setTimeout(() => cluster.fork(), pause);
    }
  });
} else {

// Bewusst require() statt import: dieser Block läuft nur im Worker-Zweig.
// Ein top-level import würde Express/DB-Pool/Routen auch im Cluster-Primary
// laden. `as typeof import(...)` liefert trotzdem volle Typisierung.
// Ausführlich: docs/begruendungen/server.ts.md#express
const express = require('express') as typeof import('express');

const session = require('express-session') as typeof import('express-session');
const fs      = require('fs') as typeof import('fs');
const compression = require('compression') as typeof import('compression');
const pgSession   = (require('connect-pg-simple') as typeof import('connect-pg-simple'))(session);
const { pool }    = require('./db/database') as typeof import('./db/database');

const app  = express();
// Verrät nur, womit der Server gebaut ist — wer sucht, soll es nicht geschenkt bekommen.
app.disable('x-powered-by');
const PORT = konfig().port;

// Gzip/Brotli compression for all responses — index.html is ~189KB, saves ~80%
app.use(compression({
  level: 6,           // good balance of speed vs ratio
  threshold: 1024,    // compress anything > 1 KB
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
    // 'unsafe-inline' ist entfallen: Sämtliche Inline-Handler sind durch den
    // delegierten Dispatcher in js/11-actions.js ersetzt (data-click,
    // data-change, …). Damit greift die CSP jetzt tatsächlich als zweite
    // Verteidigungslinie — bei einer übersehenen XSS-Lücke würde eingeschleustes …
    // Ausführlich: docs/begruendungen/server.ts.md#port-2
    "script-src 'self'",
    // Google Fonts sind entfallen: Schriften liegen unter
    // public/vendor/fonts/ (siehe fonts.css dort). Damit brauchen weder
    // style-src noch font-src einen Fremdhost — und eine LAN-Installation
    // bekommt die Typografie auch ohne Internet. Ohne 'unsafe-inline': Das
    // Markup trägt data-stil, und js/00-stile.js setzt nur freigegebene Werte
    // per CSSOM, das die CSP nicht betrifft.
    "style-src 'self'",
    "font-src 'self'",
    // img-src ohne https:. Der Kommentar hier lautete „Set-Bilder von CDNs
    // laden direkt" — das stimmt seit hardened-69 nicht mehr: imgUrl() in
    // public/js/01-core.js schickt JEDE absolute Adresse durch
    // /api/img-proxy, und alle Bilder verlangen Anmeldung. Ein pauschales
    // https: liess dagegen einen Kanal offen, den connect-src 'self' gerade
    // schliesst: Ein eingeschleuster <img src="https://fremd/?daten"> ist
    // eine Anfrage nach draussen, auch ohne Skript.
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
// Das Konto der Anfrage für Zähler tief unten (utils/apiKontingent.ts).
app.use((require('./utils/anfrageKonto') as typeof import('./utils/anfrageKonto')).merkeAnfrage);
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

/**
 * `req.body` ist immer ein Objekt — die Zusicherung von Express 4, nachgebaut.
 * Ausführlich: docs/begruendungen/server.ts.md#abschnitt-2
 */
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Hinter einem TLS-terminierenden Reverse-Proxy muss Express X-Forwarded-Proto
// glauben, sonst setzt es das secure-Cookie nie. Wem genau: utils/proxyVertrauen.ts.
if (konfig().produktion)
  app.set('trust proxy', (require('./utils/proxyVertrauen') as typeof import('./utils/proxyVertrauen'))
    .proxyVertrauen(konfig().trustProxy));
  app.use((require('./utils/proxyVertrauen') as typeof import('./utils/proxyVertrauen'))
    .proxyHinweis(konfig().trustProxy));

// Doppelte Schrägstriche im Pfad zusammenfassen
// `//api/img-proxy?url=…` trifft in Express NICHT auf `/api/img-proxy`. Die
// Anfrage fällt stattdessen durch bis zum SPA-Catch-all und bekommt
// index.html — mit **Status 200** und `text/html`. Im Browser ist das eine …
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-3
app.use((req, _res, next) => {
  if (req.url.startsWith('//') || req.url.includes('//', 1)) {
    const [pathTeil, ...rest] = req.url.split('?');
    // split() liefert immer mindestens ein Element — auch fuer den leeren
    // String. `?? ''` sagt das dem Pruefer, es ist kein zweiter Fall.
    const pathPart = pathTeil ?? '';
    const cleaned = pathPart.replace(/\/{2,}/g, '/');
    if (cleaned !== pathPart) req.url = cleaned + (rest.length ? '?' + rest.join('?') : '');
  }
  next();
});

app.use((require('./utils/herkunft') as typeof import('./utils/herkunft')).nurEigeneHerkunft);
{
  const { API_VERSION, API_MIN_APP, appFassungPruefen } = require('./utils/apiVersion') as typeof import('./utils/apiVersion');
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Api-Version', String(API_VERSION));
    res.setHeader('X-Api-Min-App', String(API_MIN_APP));
    next();
  }, appFassungPruefen);
}

// Jede Anfrage bekommt eine kurze Kennung, die in allen Logzeilen dieser
// Anfrage erscheint (siehe _intercept oben). Ein vom Reverse-Proxy gesetzter
// X-Request-Id-Header wird übernommen, damit sich Proxy- und App-Log
// zusammenführen lassen.
let _ridSeq = 0;
app.use((req, res, next) => {
  const incoming = String(req.headers['x-request-id'] || '').slice(0, 32);
  const rid = incoming || (_ridSeq = (_ridSeq + 1) % 100000).toString(36).padStart(4, '0');
  res.setHeader('X-Request-Id', rid);
  _reqContext.run({ rid }, () => next());
});

// PostgreSQL session store — required for cluster mode so all workers share sessions.
// Falls back gracefully if the session table doesn't exist yet (initSchema creates it).
const sitzungsSpeicher = new pgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: false,  // table created in initSchema to avoid race condition
  pruneSessionInterval: 60 * 15,
  // Die Leerlauf-Frist der Webapp-Sitzung
  // Bis hierher stand hier KEIN `ttl`. Dann gilt die Voreinstellung von
  // connect-pg-simple — ein Tag —, und die war nie eine Entscheidung,
  // sondern das, was übrig bleibt, weil das Cookie unten kein `maxAge` …
  // Ausführlich: docs/begruendungen/server.ts.md#sitzungsspeicher
  ttl: SITZUNG_LEERLAUF_SEK,
  errorLog: (err) => {
    if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
      console.error('[session-store]', err.message);
    }
  },
});

// Die Ablaufzeit der Sitzung wird gedrosselt geschrieben — die Messung und die
// Begruendung stehen in utils/sitzungsBeruehrung.ts.
drossleBeruehren(sitzungsSpeicher);

app.use(session({
  store: sitzungsSpeicher,
  secret: (() => {
    // Die Platzhalter aus compose.yaml/README sind öffentlich: Mit ihnen
    // signierte Sitzungen könnte jeder selbst erzeugen.
    const PLATZHALTER = [
      'change-me-to-a-long-random-string',
      'hier-langen-zufalls-string-eintragen',
      'brickinventory-manager-dev-secret',
    ];
    const gesetzt = konfig().sessionSecret;
    if (gesetzt) {
      if (konfig().produktion) {
        if (PLATZHALTER.includes(gesetzt.trim())) {
          console.error('❌ [session] SESSION_SECRET steht noch auf dem Beispielwert aus compose.yaml — Start verweigert. Bitte einen eigenen Zufallswert eintragen, z. B. `openssl rand -base64 48`.');
          process.exit(1);
        }
        if (gesetzt.trim().length < 32) {
          console.error(`❌ [session] SESSION_SECRET ist zu kurz (${gesetzt.trim().length} Zeichen, nötig sind mindestens 32) — Start verweigert.`);
          process.exit(1);
        }
      }
      return gesetzt;
    }
    if (konfig().produktion) {
      // Fail-fast: In Produktion ohne SESSION_SECRET zu starten hiesse, dass
      // Session-Cookies mit einem öffentlich bekannten Secret signiert werden —
      // dann lieber gar nicht starten, der Fehler fällt sofort beim Deploy auf.
      console.error('❌ [session] SESSION_SECRET ist nicht gesetzt — Start verweigert. Bitte in compose.yaml/ENV setzen.');
      process.exit(1);
    }
    return 'brickinventory-manager-dev-secret';  // nur ausserhalb von production
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    // No maxAge = session cookie: expires when browser closes
    // httpOnly prevents JS access, sameSite prevents CSRF
    httpOnly: true,
    sameSite: 'lax',
    // Cookie nur über HTTPS senden. Default: in Produktion aktiv; per
    // COOKIE_SECURE=0 abschaltbar, falls (ausnahmsweise) ohne TLS betrieben.
    secure: konfig().cookieSecure ?? konfig().produktion,
  }
}));
app.use(sitzungsHoechstdauer());

// resolveUserId kommt aus utils/auth.js — nutzt den Token-Cache, statt pro
// Request die api_tokens-Tabelle zu befragen.
const { resolveUserId, istVerwalter } = require('./utils/auth') as typeof import('./utils/auth');
// Pfade zentral — NICHT aus __dirname ableiten, siehe utils/appPaths.ts.
const { PUBLIC_DIR } = require('./utils/appPaths') as typeof import('./utils/appPaths');
// Die Adresse des Bild-Proxys steht in utils/images.ts — EINMAL, samt der
// Begruendung, warum es die alte Schreibweise weiterhin gibt.
const { IMG_PROXY_PFAD } = require('./utils/images') as typeof import('./utils/images');

// Eigene und geteilte Anleitungen unter /data/ — samt Pfad- und Besitzerprüfung.
app.use(require('./routes/datenDateien') as typeof import('./routes/datenDateien'));
const { safeDataPath } = require('./utils/datenPfad') as typeof import('./utils/datenPfad');
// Bild-Proxy: eigene Datei (routes/imgProxy.ts).
//
// Der Block stand hier als ~440 Zeilen zwischen Session-Aufbau und
// Cluster-Orchestrierung. server.ts ist dadurch von 1242 auf gut 800 Zeilen
// geschrumpft und beschreibt jetzt wieder nur noch Aufbau und Start.
(require('./routes/imgProxy') as typeof import('./routes/imgProxy')).registerImgProxy(app);

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

    // Ein Fehler MIT eigener Zahl ist keine fehlende Datei, sondern eine
    // Aussage ueber die Anfrage — 416 fuer einen Bereich hinter dem Dateiende,
    // 403 fuer einen Pfad, den das Dateisystem verweigert. Die Ausweichwege
    // unten (Original statt Vorschau, CDN) suchen eine ANDERE DATEI; das hilft
    // hier nicht und verdeckte bei den Anleitungen die wahre Ursache
    // (utils/dateiAusliefern.ts nennt den Fall).
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
          try {
            (require('./utils/thumbs') as typeof import('./utils/thumbs')).generateThumb(webPfadOriginal).catch(logAndContinue('server:generateThumb'));
          } catch (e) { meldeUndWeiter('server:vorschau-erzeugen', e); }
        });
        return liefereDatei(res, originalPfad);
      }
    }

    // Lokale Datei fehlt -> CDN-Adresse aus dem Katalog holen und dorthin
    // umleiten (über den Bild-Proxy, der die Hotlink-Kopfzeilen setzt). Heilt
    // Web und Android, ohne dass verwaiste image_local-Einträge in der
    // Datenbank bereinigt werden müssen.
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
  // `index: false` — und das ist der Punkt, nicht eine Kleinigkeit
  // Ohne diese Zeile liefert express.static die index.html fuer `/` SELBST
  // aus und kommt damit dem SPA-Catch-all zuvor. Die Startseite ging also am
  // Renderer (utils/indexHtml.ts) vorbei — an genau der Adresse, die jeder …
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
// Sie stehen hier direkt und nicht in einem Router, und das bleibt so: Beide
// werden gefragt, waehrend Schema und Migrationen noch laufen — zu dem
// Zeitpunkt ist der /api/v1-Router noch gar nicht eingehaengt. Express nimmt …
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-6

// Startzustand — ohne Anmeldung, wird VOR dem Login gebraucht.
app.get('/api/v1/startup-status', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // First check in-memory state (most current for this worker)
  const mem = startZustand();
  if (mem?.ready) return res.json(mem);

  // Try DB for cross-worker state
  try {
    const roh = await liesZustand('startup_status');
    if (roh) {
      const status = JSON.parse(roh);
      setzeStartZustand(status);
      return res.json(status);
    }
  } catch(_) {}

  // Fallback to in-memory or default
  res.json(mem || { ready: false, step: 'Starte…', progress: 0, total: 6 });
});

// Gesundheitscheck samt Verbindungspool — ohne Anmeldung (compose.yaml).
// Der Startzustand ist öffentlich (der Ladebildschirm vor der Anmeldung
// braucht ihn); Pool und Laufzeit verraten Last und Neustarts — nur für den
// Verwalter.
app.get('/api/v1/health', async (req, res) => {
  // Klemmt die Datenbank, bleibt der Bericht trotzdem erreichbar — nur ohne Details.
  const verwalter = !!(await resolveUserId(req).catch(logAndContinue('health:anmeldung'))) && istVerwalter(req);
  const { getPoolStats } = require('./db/database') as typeof import('./db/database');
  res.json({
    status: startZustand().ready ? 'ok' : 'starting',
    startup: startZustand(),
    ...(verwalter ? { db_pool: getPoolStats ? getPoolStats() : {},
                      uptime_seconds: Math.floor(process.uptime()) } : {}),
  });
});

// EIN Adressraum mit EINEM Eingang: anmeldungAmEingang verlangt Sitzung oder
// Token für alles unter /api/v1 ausser den ausdrücklich öffentlichen Pfaden.
// Der Schutz je Route bleibt als zweite Linie und kostet keinen zweiten Abruf.
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-7
app.use('/api/v1',          (require('./routes/api_v1/middleware') as typeof import('./routes/api_v1/middleware')).anmeldungAmEingang);
app.use('/api/v1',          require('./routes/api_v1/index') as typeof import('./routes/api_v1/index'));
app.use('/api/v1/settings', require('./routes/settings') as typeof import('./routes/settings'));
app.use('/api/v1/auth',     require('./routes/auth') as typeof import('./routes/auth'));

// ── E-Mail Bestätigung: /verify?token=... ─────────────────────────────────────
// Der Link in der Bestätigungs-Mail zeigt hierher.
// Wir leiten direkt an den Auth-Handler weiter.
app.get('/verify', async (req, res) => {
  // Die Prüfung steht in utils/auth (verifiziereEmailToken); hier bleibt die
  // Antwortform: Der Link kommt aus einer E-Mail, also eine Seite, kein JSON.
  const { verifiziereEmailToken } = require('./utils/auth') as typeof import('./utils/auth');
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
  // Ueber den Renderer und nicht per sendFile: Sonst gingen von hier aus die
  // Assets OHNE Stempel hinaus (utils/assetStempel.ts) und mit dem
  // Standarddesign — wer seine Seite ueber den Link aus der Mail oeffnet,
  // bekaeme sonst als einziger die alten Dateien aus dem Cache.
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
    // data-theme wird serverseitig gesetzt (utils/indexHtml.ts). Ohne das
    // startet ein Browser ohne localStorage-Cache im Standarddesign und
    // springt nach dem Abgleich sichtbar um.
    // userId mitgeben, damit die passende Sprachdatei im <head> steht
    // (siehe utils/indexHtml.ts). Ohne Session → Vorgabe Deutsch.
    res.type('html').send(await renderIndexHtml(req.session?.userId));
  } catch (e) {
    // Fällt das Rendern aus, bleibt die Datei unverändert ausgeliefert —
    // js/00-theme-boot.js übernimmt dann wie bisher.
    res.sendFile('index.html', { root: PUBLIC_DIR });
  }
});

// Fängt synchron geworfene Fehler und next(err)-Aufrufe, die an den
// Route-Catches vorbeikommen — loggt voll, antwortet generisch.
const { handleRouteError: _handleRouteError } = require('./utils/httpError') as typeof import('./utils/httpError');
app.use((err: any, req: Request, res: Response, _next: NextFunction) => { _handleRouteError(res, err, undefined, req); });

// Der Server nimmt Anfragen erst an, NACHDEM bereiteDatenbankVor() das Schema
// (inkl. user_sessions) fertig hat — sonst schlägt der Session-Store mit
// "relation \"user_sessions\" does not exist" fehl (Race beim Start / frische DB).
// app.listen() steht daher im bereiteDatenbankVor().then(...)-Callback weiter unten.

// Initialise DB schema, then run CSV sync
const db = require('./db/database') as typeof import('./db/database');
const { renderIndexHtml } = require('./utils/indexHtml') as typeof import('./utils/indexHtml');

// Elect a primary worker using a PostgreSQL advisory lock (lock ID 99999999).
// The first worker to acquire it becomes primary and runs background jobs.
// If it dies and restarts, it will re-acquire on next startup.
let isPrimaryWorker = false;
let _primaryLockClient: import('pg').PoolClient | null = null; // dedizierte Verbindung, die den Advisory-Lock hält
// Geordnet beenden mit Code 1, damit der Cluster neu startet; gesetzt, sobald
// shutdown() steht. Ohne Cluster (Entwicklung) bleibt es bei der Warnung.
let neuStarten: ((grund: string) => void) | null = null;

/**
 * Die Verbindung mit der Primär-Sperre offen halten. Reisst sie ab (Neustart
 * der Datenbank, Netz), ist die Sperre frei; die Jobs dieses Prozesses laufen
 * weiter. Darum holt er sie sich auf einer neuen Verbindung zurück, statt
 * ohne Sperre Primär zu spielen.
 */
const SPERRE_NEU_MS = 2000;
function haltePrimaerSperre(db: typeof import('./db/database'), client: import('pg').PoolClient) {
  _primaryLockClient = client;
  let weg = false;
  const verloren = () => {
    if (weg) return;
    weg = true;
    _primaryLockClient = null;
    try { client.release(new Error('Primär-Sperre verloren')); } catch (e) { meldeUndWeiter('cluster:sperre-verbindung', e); }
    console.warn(`[cluster] Worker ${process.pid}: Verbindung mit der Primär-Sperre verloren — neuer Versuch`);
    setTimeout(() => sperreNeuHolen(db), SPERRE_NEU_MS).unref();
  };
  client.on('error', verloren);
  client.on('end', verloren);
}

async function sperreNeuHolen(db: typeof import('./db/database')) {
  let client: import('pg').PoolClient | null = null;
  try {
    client = await db.pool.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok',
      [(require('./utils/lockNamespaces') as typeof import('./utils/lockNamespaces')).LOCKS.PRIMARY_WORKER]);
    if (rows[0]?.ok) { haltePrimaerSperre(db, client); return; }
    client.release();
    // Ein anderer Worker hält sie jetzt; dann laufen die Jobs dort — und die
    // Planer dieses Prozesses dürfen nicht weiterlaufen. Ein Neustart macht
    // ihn zum Sekundär-Worker.
    isPrimaryWorker = false;
    console.warn(`[cluster] Worker ${process.pid}: Primär-Sperre hält jetzt ein anderer Worker`);
    if (cluster.isWorker) neuStarten?.('Primär-Sperre an einen anderen Worker verloren');
  } catch (e) {
    try { client?.release(e instanceof Error ? e : true); } catch (f) { meldeUndWeiter('cluster:sperre-verbindung', f); }
    setTimeout(() => sperreNeuHolen(db), SPERRE_NEU_MS).unref();
  }
}

async function electPrimaryWorker(db: typeof import('./db/database')) {
  try {
    // Den Advisory-Lock auf einer DEDIZIERTEN Verbindung halten, die NICHT in
    // den Pool zurückgegeben wird. Sonst schliesst der Pool die Session beim
    // Idle-Timeout (PG_IDLE_MS) und gibt damit den Session-Lock frei — dann
    // könnten sich mehrere Worker gleichzeitig für "primary" halten und
    // Hintergrund-Jobs (z. B. der Bild-Download) liefen mehrfach parallel.
    const client = await db.pool.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok',
      [(require('./utils/lockNamespaces') as typeof import('./utils/lockNamespaces')).LOCKS.PRIMARY_WORKER]);
    isPrimaryWorker = !!rows[0]?.ok;
    if (isPrimaryWorker) {
      haltePrimaerSperre(db, client);
    } else {
      client.release();                            // Lock nicht bekommen → Verbindung zurückgeben
    }
  } catch (_) {
    isPrimaryWorker = false;
  }
  console.log(`[cluster] Worker ${process.pid} is ${isPrimaryWorker ? 'PRIMARY (jobs will run here)' : 'secondary (jobs handled by primary)'}`);
  return isPrimaryWorker;
}

bereiteDatenbankVor().then(async () => {
  // (Hier stand loadDailyLimitsFromDb(): Das Tageslimit musste beim Start in
  // einen In-Memory-Limiter geladen werden. Der Zähler liegt jetzt in der
  // Datenbank und liest die Grenze bei jedem Aufruf — siehe
  // consumeRebrickableDaily() in utils/rateLimiter.ts.)

  // Schema ist jetzt fertig (user_sessions existiert) → erst JETZT Anfragen annehmen.
  const httpServer = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║       🧱 BrickInventory Manager v3.0               ║
╠════════════════════════════════════════════╣
║  http://localhost:${PORT}                    ║
╚════════════════════════════════════════════╝`);
  });
  // Geordnetes Herunterfahren
  // Ohne SIGTERM-Handler beendet `docker compose down` (oder jedes Deploy) den
  // Prozess hart: Laufende Anfragen brechen mitten in der Antwort ab, offene
  // SSE-Verbindungen bekommen kein Ende, und ein CSV-Import wird zwischen zwei …
  // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-shutdown-timeout-ms
  const SHUTDOWN_TIMEOUT_MS = 8000;
  let shuttingDown = false;

  async function shutdown(signal: string, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} empfangen — Server wird geordnet beendet`);

    // Reissleine: Bleibt eine Verbindung hängen (typischerweise ein SSE-Strom,
    // der gerade kein Ereignis hat), wird nach Ablauf trotzdem beendet.
    const force = setTimeout(() => {
      // Exit-Code 0: Die Frist ist eine Notbremse für hängende Verbindungen,
      // kein Fehler. Vorher stand hier 1 — und weil die Frist bei JEDEM
      // Neustart ablief (siehe oben), meldete der Container bei jedem Deploy
      // einen Fehlschlag. Ein echter Fehler wird unten weiterhin mit 1
      // quittiert.
      console.warn('[shutdown] Frist abgelaufen — Beenden wird erzwungen');
      process.exit(code);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    try {
      // ZUERST die SSE-Ströme beenden, DANN auf close() warten: close()
      // wartet auf die letzte Verbindung, und ein SSE-Strom endet nie von selbst.
      const beendet = (require('./utils/sseRegistry') as typeof import('./utils/sseRegistry')).closeAllSse();
      if (beendet) console.log(`[shutdown] ${beendet} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
      // Laufende Aufträge halten an einer sicheren Stelle an und gehen zurück
      // in die Tabelle; der nächste Start setzt sie fort.
      await stoppeAuftragsWorker().catch(logAndContinue('shutdown:auftraege'));
      await (require('./utils/pgNotify') as typeof import('./utils/pgNotify')).close().catch(logAndContinue('server:close'));
      // Die Sperr-Verbindung des primaeren Workers ZUERST zurueckgeben.
      // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker
      if (_primaryLockClient) {
        // Ein Fehler hier heisst: Die Verbindung ist schon tot — dann ist der
        // Lock ohnehin weg.
        try { _primaryLockClient.release(); } catch { void 0; }
        _primaryLockClient = null;
      }
      await (require('./db/database') as typeof import('./db/database')).pool.end().catch(logAndContinue('server:end'));
      console.log('[shutdown] Datenbankverbindungen geschlossen');
      clearTimeout(force);
      process.exit(code);
    } catch (e) {
      console.error('[shutdown] Fehler beim Beenden:', fehlertext(e));
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  neuStarten = (grund) => { void shutdown(grund, 1); };

  protokollInDieDatenbank(db.pool);
  setzeStartZustand({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  const csvSync = require('./jobs/rebrickableCsvSync') as typeof import('./jobs/rebrickableCsvSync');

  await electPrimaryWorker(db);

  // Sekundär-Worker sehen nach, ob noch jemand Primär ist. Fehlt er zweimal
  // hintereinander, startet dieser Worker neu und bewirbt sich dabei; der
  // frühere Primär holt seine Sperre nach einem Abriss binnen Sekunden zurück.
  if (!isPrimaryWorker && cluster.isWorker) {
    const { primaerFehlt } = require('./utils/primaerWache') as typeof import('./utils/primaerWache');
    let fehlt = 0;
    setInterval(async () => {
      try { fehlt = (await primaerFehlt(db)) ? fehlt + 1 : 0; }
      catch (e) { meldeUndWeiter('cluster:primaer-wache', e); return; }
      if (fehlt >= 2) neuStarten?.('kein Primär-Worker mehr');
    }, 60_000).unref();
  }

  // Cache-Signale in JEDEM Worker anmelden, also vor jeder Primär-Prüfung:
  // Jeder Worker hält eigene Caches für Haushalt und Token, und jeder muss
  // erfahren, wenn sie veraltet sind.
  // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-2
  (require('./utils/pgNotify') as typeof import('./utils/pgNotify'))
    .listen(HAUSHALT_KANAL, () => leereHaushaltCache());
  (require('./utils/auth') as typeof import('./utils/auth')).horcheAufTokenWiderruf();

  // Only primary worker clears stale startup_status — secondaries read it from DB
  if (isPrimaryWorker) {
    await loescheZustand('startup_status').catch(logAndContinue('server:loescheZustand'));
    // Über console.warn landet der Hinweis in app_logs, also im Protokoll der Verwaltung.
    if (konfig().produktion
        && (require('./utils/konfig') as typeof import('./utils/konfig')).standardPasswortInBenutzung())
      console.warn('⚠️ [sicherheit] Die Datenbank benutzt das Beispielpasswort aus compose.yaml. '
        + 'Bitte ändern (ALTER USER brickinventory PASSWORD …) und DB_PASSWORD in .env setzen — siehe README.md.');
  }

  (async () => {
    if (isPrimaryWorker) {
      try {
        await csvSync.run();
      } catch(e) {
        console.error('[rb-csv-sync] startup error:', fehlertext(e));
        setzeStartZustand({ ready: true, step: 'Fehler beim CSV-Import', progress: 6, total: 6 });
      }
    } else {
      // Non-primary workers wait for primary to finish startup sync
      while (true) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const roh = await liesZustand('startup_status');
          if (roh) {
            const s = JSON.parse(roh);
            setzeStartZustand(s);
            if (s.ready) break;
          }
        } catch(_) {}
      }
    }

    if (!isPrimaryWorker) return; // all background jobs below: primary worker only

    // Die Staffel der Hintergrundläufe steht in
    // startup/backgroundJobs.ts — beieinander statt über hundertdreissig
    // Zeilen verstreut. Die Bedingung darüber ist die EINZIGE Stelle, an der
    // „nur im Primär-Worker" geprüft wird.
    await starteHintergrundlaeufe();
  })();


  if (!isPrimaryWorker) return; // scheduled jobs: primary worker only

  // Tägliche Jobs mit im Monitoring konfigurierbarer Uhrzeit (HH:MM).
  // Standard: Brickset-Retry 04:00, CSV-Re-Sync 03:00. Änderungen greifen sofort
  // (Reschedule-Trigger, siehe jobs/dailyScheduler.js).
  const scheduler = require('./jobs/dailyScheduler') as typeof import('./jobs/dailyScheduler');
  scheduler.register('brickset_retry', () =>
    (require('./jobs/bricksetRetry') as typeof import('./jobs/bricksetRetry')).processRetryQueue().catch(e => console.error('[brickset-retry]', e.message)));
  scheduler.register('csv_sync', () =>
    loescheZustand('rb_csv_last_sync')
      .then(() => csvSync.run())
      .catch(e => console.error('[rb-csv-sync daily]', e.message)));
  scheduler.startTriggerPoll();

  // CSV-Sync auf Zuruf statt im 5-Sekunden-Takt.
  // Der Eintrag in laufzustand bleibt die belastbare Quelle; das
  // NOTIFY-Signal weckt nur sofort. Beim Verbinden prüft der Handler den
  // Eintrag einmal von sich aus, sodass ein während einer Trennung verpasstes
  // Signal nachgeholt wird (siehe utils/pgNotify.ts).
  let _csvSyncRunning = false;
  (require('./utils/pgNotify') as typeof import('./utils/pgNotify')).listen('csv_sync_trigger', async () => {
    if (_csvSyncRunning) return;
    try {
      const ausloeser = await liesZustand('csv_sync_trigger');
      if (!ausloeser) return;
      await loescheZustand('csv_sync_trigger').catch(logAndContinue('server:loescheZustand'));
      console.log('[rb-csv-sync] Manual trigger received — starting CSV sync');
      _csvSyncRunning = true;
      await loescheZustand('rb_csv_last_sync').catch(logAndContinue('server:loescheZustand'));
      await csvSync.run().catch(e => console.error('[rb-csv-sync manual]', e.message));
    } catch (e) { meldeUndWeiter('server:csv-abgleich-anstossen', e); }
    finally { _csvSyncRunning = false; }
  });

  (require('./startup/bildNachlauf') as typeof import('./startup/bildNachlauf')).starteBildNachlauf();

}).catch(err => {
  console.error('❌ Database initialisation failed:', err.message);
  console.error('   Check PostgreSQL connection settings (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
  process.exit(1);
});

} // end cluster worker block
