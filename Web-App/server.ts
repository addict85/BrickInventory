import type { Request, Response, NextFunction } from 'express';

/**
 * Anfrage einer Wildcard-Route (`app.get('/images/*pfad', …)`).
 * Ausführlich: docs/begruendungen/server.ts.md#wildcardrequest
 */
type WildcardRequest = Request<{ pfad: string[] }>;
// ── Log interceptor — write console output to PostgreSQL app_logs ─────────────
// Must be first so all subsequent logs are captured
const _logBuffer: any[] = [];
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
(global as any)._reqContext = _reqContext;

/** Kurze Prozesskennung, damit im Log erkennbar ist, welcher Worker schrieb. */
const _pidTag = String(process.pid).slice(-4);

function _intercept(level: string, orig: (...a: any[]) => void) {
  return function(...args: any[]) {
    const ctx = _reqContext.getStore();
    const prefix = ctx?.rid ? `[${_pidTag}/${ctx.rid}] ` : `[${_pidTag}] `;
    orig.apply(console, [prefix + _safeStringify(args[0]), ...args.slice(1)]);
    const msg = prefix + args.map(_safeStringify).join(' ');
    _logBuffer.push({ level, message: msg.substring(0, 4000) });
    // Puffer kappen: solange der DB-Pool noch nicht bereit ist (oder die DB
    // down ist), würde der Buffer sonst unbegrenzt wachsen (Memory-Leak).
    //
    // Gekappt wird am ANFANG, es überleben also die neuesten 500. Das ist eine
    // bewusste Wahl und keine gute: Bei einem Fehlersturm ist die erste
    // Meldung meist die aussagekräftige. Deshalb geht jede Zeile zusätzlich
    // unverändert nach stdout/stderr (orig.apply oben) — der Docker-Log-Treiber
    // hat sie also auch dann, wenn die Datenbank sie nie zu sehen bekommt.
    if (_logBuffer.length > 500) _logBuffer.splice(0, _logBuffer.length - 500);
    if (_logTimer) clearTimeout(_logTimer);
    _logTimer = setTimeout(() => { _logTimer = null; _flushLogs(); }, 1500);
  };
}
console.log   = _intercept('info',  console.log);
console.info  = _intercept('info',  console.info);
console.warn  = _intercept('warn',  console.warn);
console.error = _intercept('error', console.error);
global._enableLogPersistence = (pool) => { _logPool = pool; _flushLogs(); };

// Prevent worker crashes from unhandled promise rejections
// Log them instead of crashing the process
process.on('unhandledRejection', (reason: any, _promise) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  // Nach einer uncaught Exception ist der Prozesszustand potenziell korrupt
  // (halb offene Transaktionen, hängende Handles). Loggen, Logs flushen und
  // kontrolliert beenden — der Cluster-Primary forkt sofort einen Ersatz-Worker.
  console.error('[uncaughtException] Uncaught exception:', err.stack || err.message);
  try { _flushLogs(); } catch (_) {}
  setTimeout(() => process.exit(1), 500).unref();
});

// Set IMMEDIATELY — before any requires or async code
global.startupStatus = { ready: false, step: 'Datenbank wird initialisiert...', progress: 0, total: 6 };

// ── Cluster: fork one worker per CPU so multiple requests run in parallel ─────
import { fehlertext, logAndContinue, meldeUndWeiter } from './utils/httpError';
import cluster from 'cluster';
import os from 'os';
import { starteHintergrundlaeufe } from './startup/backgroundJobs';
import { getGlobalSetting, deleteGlobalSetting } from './utils/settings';
import { HAUSHALT_KANAL, leereHaushaltCache } from './utils/household';
import { drossleBeruehren } from './utils/sitzungsBeruehrung';
import { SITZUNG_LEERLAUF_SEK } from './utils/sitzungsFrist';
import { antwortAufDateiFehler, liefereDatei } from './utils/dateiAusliefern';

const WORKERS = parseInt(process.env.WEB_WORKERS || '0') || Math.max(2, os.cpus().length);

if (cluster.isPrimary && process.env.NODE_ENV === 'production') {
  console.log(`[cluster] Primary ${process.pid} starting ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker, code) => {
    if (code !== 0) {
      console.warn(`[cluster] Worker ${worker.process.pid} died (code ${code}) — restarting`);
      cluster.fork();
    }
  });
} else {

// Bewusst require() statt import: dieser Block läuft nur im Worker-Zweig.
// Ein top-level import würde Express/DB-Pool/Routen auch im Cluster-Primary
// laden. `as typeof import(...)` liefert trotzdem volle Typisierung.
// Ausführlich: docs/begruendungen/server.ts.md#express
const express = require('express') as typeof import('express');

//  Async-Handler absichern
// Express 4 kennt keine Promises: Wirft ein `async (req, res) => …`-Handler,
// landet die Rejection nirgends — die Antwort bleibt aus, die Verbindung offen.
// Ein Reverse-Proxy davor wartet auf sein Timeout und liefert dann 502. Genau …
// Ausführlich: docs/begruendungen/server.ts.md#router
const _Router = express.Router;
function _wrapAsync(fn: any) {
  if (typeof fn !== 'function' || fn.length >= 4) return fn;   // Fehler-Middleware unangetastet
  // `this: unknown` benennt nur, was Express ohnehin uebergibt — der Wrapper
  // reicht es unveraendert an fn.call() weiter und liest es selbst nie.
  const wrapped = function (this: unknown, req: any, res: any, next: any) {
    let out;
    try { out = fn.call(this, req, res, next); }
    catch (e) { return next(e); }                              // synchroner Wurf
    if (out && typeof out.then === 'function') out.catch(next); // asynchroner
    return out;
  };
  Object.defineProperty(wrapped, 'length', { value: fn.length });
  return wrapped;
}
(express as any).Router = function (...args: any[]) {
  const router = (_Router as any).apply(this, args);
  for (const method of ['get', 'post', 'put', 'delete', 'patch', 'all', 'use']) {
    const original = router[method].bind(router);
    router[method] = (...handlers: any[]) => original(...handlers.map(_wrapAsync));
  }
  return router;
};
const session = require('express-session') as typeof import('express-session');
const path    = require('path') as typeof import('path');
const fs      = require('fs') as typeof import('fs');
const compression = require('compression') as typeof import('compression');
const pgSession   = (require('connect-pg-simple') as typeof import('connect-pg-simple'))(session);
const { pool }    = require('./db/database') as typeof import('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

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
// ohnehin auf die App zugeschnitten sein. 'unsafe-inline' bei script/style ist
// nötig, weil index.html Inline-onclick-Handler und Inline-Styles verwendet —
// die Header schützen trotzdem gegen fremdes Framing (Clickjacking durch andere
// Seiten; same-origin ist für den eigenen PDF-Viewer erlaubt), MIME-Sniffing
// und fremde Ressourcen-Quellen.
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
  const hstsAlter = process.env.HSTS_MAX_AGE ?? '31536000';   // ein Jahr
  if (ueberTls && hstsAlter !== '0') {
    res.setHeader('Strict-Transport-Security',
      `max-age=${parseInt(hstsAlter) || 31536000}; includeSubDomains`);
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
    // bekommt die Typografie auch ohne Internet.
    "style-src 'self' 'unsafe-inline'",
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
  ].join('; '));
  next();
});

// Body-Grenzen: knapp als Standard, grosszügig nur wo nötig.
//
// VORHER galt 10 MB für JEDEN Endpunkt. Der Kommentar nannte den Grund — die
// Teileliste für den PDF-Export — aber die Ausnahme war global. Bei acht
// Workern heisst das: jede beliebige Route nimmt 10-MB-Körper an, und ein
// einzelner Client kann damit ohne Aufwand achtzig Megabyte Heap belegen.
// Jetzt: 256 KB überall (grosszügig für JSON-Nutzlasten dieser App), und die
// PDF-Routen setzen ihr eigenes Limit per Router-Middleware (routes/api_v1/pdf.ts).
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

/**
 * `req.body` ist immer ein Objekt — die Zusicherung von Express 4, nachgebaut.
 * Ausführlich: docs/begruendungen/server.ts.md#abschnitt-2
 */
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Hinter einem TLS-terminierenden Reverse-Proxy muss Express X-Forwarded-Proto
// glauben, sonst setzt es das secure-Cookie nie. Wem genau: utils/proxyVertrauen.ts.
if (process.env.NODE_ENV === 'production')
  app.set('trust proxy', (require('./utils/proxyVertrauen') as typeof import('./utils/proxyVertrauen'))
    .proxyVertrauen(process.env.TRUST_PROXY));

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
  const { API_VERSION, API_MIN_APP } = require('./utils/apiVersion') as typeof import('./utils/apiVersion');
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Api-Version', String(API_VERSION));
    res.setHeader('X-Api-Min-App', String(API_MIN_APP));
    next();
  });
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
    // Aus compose.yaml/README bekannte Platzhalter. Sie sind öffentlich — ein
    // damit signiertes Session-Cookie kann jeder selbst erzeugen und sich als
    // beliebiger Benutzer ausgeben. Der Fail-fast prüfte bisher nur, OB die
    // Variable gesetzt ist; wer `docker compose up` ungelesen ausführte, lief
    // also mit einem allgemein bekannten Secret in Produktion — genau die
    // Situation, die der Fail-fast verhindern sollte.
    const PLATZHALTER = [
      'change-me-to-a-long-random-string',
      'hier-langen-zufalls-string-eintragen',
      'brickinventory-manager-dev-secret',
    ];
    const gesetzt = process.env.SESSION_SECRET;
    if (gesetzt) {
      if (process.env.NODE_ENV === 'production') {
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
    if (process.env.NODE_ENV === 'production') {
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
    secure: process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === '1'
      : process.env.NODE_ENV === 'production',
  }
}));

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

// Fallback-Cache: fehlende lokale Bilddatei -> CDN-URL (oder null). Vermeidet
// wiederholte DB-Lookups, wenn viele Bilder lokal fehlen (z.B. nach Redeploy
// eines nicht-persistenten data-Volumes oder bei früher fehlgeschlagenen
// Downloads, deren image_local dennoch gesetzt wurde).
const _missingImgCdnCache = new Map<string, { url: string | null, at: number }>();

async function lookupCdnForMissingImage(webPath: string): Promise<string | null> {
  const cached = _missingImgCdnCache.get(webPath);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.url;
  // Dateiname ohne _thumb-Suffix und ohne Endung -> passt auf image_local per LIKE
  const fileName = webPath.split('/').pop() || '';
  const stem = fileName.replace(/_thumb\.jpg$/i, '').replace(/\.[^.]+$/, '');
  const esc  = stem.replace(/([%_\\])/g, '\\$1'); // LIKE-Sonderzeichen escapen
  const like = `%/${esc}.%`;
  let url: string | null = null;
  try {
    // minifigs mit aufgenommen: Figuren-Bilder liegen seit der Trennung unter
    // /images/minifigs/, und ein fehlendes Bild einer MANUELL erfassten Figur
    // war vorher nicht heilbar — die Tabelle stand nicht in dieser Liste.
    for (const tbl of ['set_parts_catalog', 'set_minifigs_catalog', 'parts', 'minifigs',
                       'sets', 'set_catalog']) {
      const r = await pool.query(
        `SELECT image_url FROM ${tbl} WHERE image_local LIKE $1 ESCAPE '\\' AND image_url IS NOT NULL LIMIT 1`,
        [like]
      );
      if (r.rows[0]?.image_url) { url = r.rows[0].image_url; break; }
    }
  } catch (_) { url = null; }
  // Ältestes Fünftel verdrängen statt alles wegwerfen (wie utils/images.ts).
  if (_missingImgCdnCache.size > 5000) {
    let n = 0;
    for (const k of _missingImgCdnCache.keys()) { _missingImgCdnCache.delete(k); if (++n >= 1000) break; }
  }
  _missingImgCdnCache.set(webPath, { url, at: Date.now() });
  return url;
}

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

  res.sendFile(filePath, async err => {
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

    // Fehlt eine VORSCHAU, gibt es fast immer das Original daneben — dann geht
    // das raus, sofort (Nachtrag 40, Marcos Anforderung: „Der Client soll das
    // Bild jeweils direkt erhalten und nicht warten, bis das Thumbs-Image
    // generiert wurde. Ist kein Thumb vorhanden, soll das grosse Bild …
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
            (require('./utils/thumbs') as typeof import('./utils/thumbs')).generateThumb(webPfadOriginal).catch(() => {});
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
    const cdn = await lookupCdnForMissingImage(webPath).catch(() => null);
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
  const mem = global.startupStatus;
  if (mem?.ready) return res.json(mem);

  // Try DB for cross-worker state
  try {
    const roh = await getGlobalSetting('startup_status');
    if (roh) {
      const status = JSON.parse(roh);
      global.startupStatus = status;
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
    status: global.startupStatus?.ready ? 'ok' : 'starting',
    startup: global.startupStatus,
    ...(verwalter ? { db_pool: getPoolStats ? getPoolStats() : {},
                      uptime_seconds: Math.floor(process.uptime()) } : {}),
  });
});

// EINE Adressraum: alles unter /api/v1
//  Warum das ohne Umbau der Anmeldung geht
// requireToken in routes/api_v1/middleware.ts nimmt beide Ausweise. Die hier
// umgehaengten Router bringen ihre eigene Absicherung mit (requireLogin, …
// Ausführlich: docs/begruendungen/server.ts.md#abschnitt-7
app.use('/api/v1',          require('./routes/api_v1/index') as typeof import('./routes/api_v1/index'));
app.use('/api/v1/sets',     require('./routes/sets') as typeof import('./routes/sets'));
app.use('/api/v1/parts',    require('./routes/parts') as typeof import('./routes/parts'));
app.use('/api/v1/settings', require('./routes/settings') as typeof import('./routes/settings'));
app.use('/api/v1/minifigs', require('./routes/minifigs') as typeof import('./routes/minifigs'));
app.use('/api/v1/auth',     require('./routes/auth') as typeof import('./routes/auth'));

// ── E-Mail Bestätigung: /verify?token=... ─────────────────────────────────────
// Der Link in der Bestätigungs-Mail zeigt hierher.
// Wir leiten direkt an den Auth-Handler weiter.
app.get('/verify', async (req, res) => {
  // Die Logik steht seit Nachtrag 154 in utils/auth.verifiziereEmailToken().
  // Vorher lagen hier acht Zeilen, die in routes/auth.ts wortgleich ein
  // zweites Mal standen — inklusive Hash-Regel und Ablaufprüfung. Wer eine
  // davon änderte, hatte die andere übersehen.
  //
  // Was HIER bleibt, ist die Antwortform: Dieser Weg wird aus einer E-Mail
  // angeklickt, also muss am Ende eine Seite stehen, keine JSON-Zeile. Die
  // Oberfläche liest ?verified= aus und zeigt die Meldung.
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
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  }
});

// ── 404 für unbekannte API-Pfade ────────────────────────────────────────────
// MUSS vor dem SPA-Catch-all stehen. Vorher war es umgekehrt: app.get('*') hat
// jeden unbekannten GET auf /api abgefangen und die ~189 KB grosse index.html
// mit Status 200 ausgeliefert. Für die Android-App hiess das, dass ein
// Tippfehler im Pfad als Serialisierungsfehler ankam statt als 404 — und jeder
// Retry hat die komplette HTML-Seite übertragen.
// Alle echten /api-Routen (inkl. img-proxy und debug/test) sind weiter oben
// registriert und damit nicht betroffen.
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
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  }
});

// Fängt synchron geworfene Fehler und next(err)-Aufrufe, die an den
// Route-Catches vorbeikommen — loggt voll, antwortet generisch.
const { handleRouteError: _handleRouteError } = require('./utils/httpError') as typeof import('./utils/httpError');
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => { _handleRouteError(res, err); });

// Der Server nimmt Anfragen erst an, NACHDEM initSchemaOnce() das Schema
// (inkl. user_sessions) fertig hat — sonst schlägt der Session-Store mit
// "relation \"user_sessions\" does not exist" fehl (Race beim Start / frische DB).
// app.listen() steht daher im initSchemaOnce().then(...)-Callback weiter unten.

// Initialise DB schema, then run CSV sync
const db = require('./db/database') as typeof import('./db/database');
const { renderIndexHtml } = require('./utils/indexHtml') as typeof import('./utils/indexHtml');

// Elect a primary worker using a PostgreSQL advisory lock (lock ID 99999999).
// The first worker to acquire it becomes primary and runs background jobs.
// If it dies and restarts, it will re-acquire on next startup.
let isPrimaryWorker = false;
let _primaryLockClient: any = null; // dedizierte Verbindung, die den Advisory-Lock hält

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
    // Ein anderer Worker hält sie jetzt; dann laufen die Jobs dort.
    isPrimaryWorker = false;
    console.warn(`[cluster] Worker ${process.pid}: Primär-Sperre hält jetzt ein anderer Worker`);
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

db.initSchemaOnce().then(async () => {
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

  async function shutdown(signal: string) {
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
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    try {
      // ZUERST die SSE-Ströme beenden, DANN auf close() warten.
      //
      // Ohne das kam der close()-Rückruf nie: Er wartet auf die letzte
      // Verbindung, und ein SSE-Strom geht von sich aus nie weg. Jeder
      // Neustart lief deshalb in die Frist unten und endete mit exit(1) —
      // für Docker sah jedes Deploy aus wie ein Absturz. Der Kommentar bei
      // der Reissleine nannte das einen Ausnahmefall; es war der Regelfall,
      // weil der Fortschrittskanal der Webapp dauerhaft offen bleibt.
      const beendet = (require('./utils/sseRegistry') as typeof import('./utils/sseRegistry')).closeAllSse();
      if (beendet) console.log(`[shutdown] ${beendet} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
      await (require('./utils/pgNotify') as typeof import('./utils/pgNotify')).close().catch(() => {});
      // Die Sperr-Verbindung des primaeren Workers ZUERST zurueckgeben.
      // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker
      if (_primaryLockClient) {
        // Ein Fehler hier heisst: Die Verbindung ist schon tot — dann ist der
        // Lock ohnehin weg.
        try { _primaryLockClient.release(); } catch { void 0; }
        _primaryLockClient = null;
      }
      await (require('./db/database') as typeof import('./db/database')).pool.end().catch(() => {});
      console.log('[shutdown] Datenbankverbindungen geschlossen');
      clearTimeout(force);
      process.exit(0);
    } catch (e: any) {
      console.error('[shutdown] Fehler beim Beenden:', e.message);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  global._enableLogPersistence((require('./db/database') as typeof import('./db/database')).pool);
  global.startupStatus = { ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 };
  const csvSync = require('./jobs/rebrickableCsvSync') as typeof import('./jobs/rebrickableCsvSync');

  await electPrimaryWorker(db);

  // Cache-Signale in JEDEM Worker anmelden, also vor jeder Primär-Prüfung:
  // Jeder Worker hält eigene Caches für Haushalt und Token, und jeder muss
  // erfahren, wenn sie veraltet sind.
  // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-2
  (require('./utils/pgNotify') as typeof import('./utils/pgNotify'))
    .listen(HAUSHALT_KANAL, () => leereHaushaltCache());
  (require('./utils/auth') as typeof import('./utils/auth')).horcheAufTokenWiderruf();

  // Only primary worker clears stale startup_status — secondaries read it from DB
  if (isPrimaryWorker) {
    await deleteGlobalSetting('startup_status').catch(() => {});
  }

  (async () => {
    if (isPrimaryWorker) {
      try {
        await csvSync.run();
      } catch(e) {
        console.error('[rb-csv-sync] startup error:', fehlertext(e));
        global.startupStatus = { ready: true, step: 'Fehler beim CSV-Import', progress: 6, total: 6 };
      }
    } else {
      // Non-primary workers wait for primary to finish startup sync
      while (true) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const roh = await getGlobalSetting('startup_status');
          if (roh) {
            const s = JSON.parse(roh);
            global.startupStatus = s;
            if (s.ready) break;
          }
        } catch(_) {}
      }
    }

    if (!isPrimaryWorker) return; // all background jobs below: primary worker only

    // Die Staffel der Hintergrundläufe steht seit Nachtrag 134 in
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
    deleteGlobalSetting('rb_csv_last_sync')
      .then(() => csvSync.run())
      .catch(e => console.error('[rb-csv-sync daily]', e.message)));
  scheduler.startTriggerPoll();

  // CSV-Sync auf Zuruf statt im 5-Sekunden-Takt.
  // Der Eintrag in global_settings bleibt die belastbare Quelle; das
  // NOTIFY-Signal weckt nur sofort. Beim Verbinden prüft der Handler den
  // Eintrag einmal von sich aus, sodass ein während einer Trennung verpasstes
  // Signal nachgeholt wird (siehe utils/pgNotify.ts).
  let _csvSyncRunning = false;
  (require('./utils/pgNotify') as typeof import('./utils/pgNotify')).listen('csv_sync_trigger', async () => {
    if (_csvSyncRunning) return;
    try {
      const ausloeser = await getGlobalSetting('csv_sync_trigger');
      if (!ausloeser) return;
      await deleteGlobalSetting('csv_sync_trigger').catch(() => {});
      console.log('[rb-csv-sync] Manual trigger received — starting CSV sync');
      _csvSyncRunning = true;
      await deleteGlobalSetting('rb_csv_last_sync').catch(() => {});
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
