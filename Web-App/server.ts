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
function _safeStringify(a) {
  if (typeof a === 'string') return a;
  try {
    const s = JSON.stringify(a);
    // Grosse Objekte kappen, bevor sie durch Buffer und DB wandern
    return s && s.length > 4000 ? s.substring(0, 4000) + '…' : (s ?? String(a));
  } catch (_) { return String(a); }
}
/**
 * Ablaufkontext der gerade bearbeiteten Anfrage.
 *
 * ── Wozu ────────────────────────────────────────────────────────────────────
 * Der Server läuft im Cluster mit mehreren Prozessen. In app_logs landeten
 * bisher nur Freitextzeilen — zwei zusammengehörige Meldungen derselben
 * Anfrage liessen sich nachträglich nicht mehr einander zuordnen, und bei
 * gleichzeitigen Anfragen stehen die Zeilen ohnehin verschachtelt.
 *
 * AsyncLocalStorage trägt die Kennung durch die gesamte await-Kette, ohne dass
 * sie durch jede Funktionssignatur gereicht werden muss.
 */
const { AsyncLocalStorage } = require('async_hooks');
const _reqContext = new AsyncLocalStorage();
(global as any)._reqContext = _reqContext;

/** Kurze Prozesskennung, damit im Log erkennbar ist, welcher Worker schrieb. */
const _pidTag = String(process.pid).slice(-4);

function _intercept(level, orig) {
  return function(...args) {
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
process.on('unhandledRejection', (reason: any, promise) => {
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
import cluster from 'cluster';
import os from 'os';
import { downloadSetImage } from './utils/setImages';
import { starteHintergrundlaeufe } from './startup/backgroundJobs';
import { bricklinkRequest } from './clients/bricklink';
import { purgeExpiredTokens } from './utils/auth';
import { purgeAltePreise } from './utils/priceHistory';
import { enqueue } from './jobs/instructionQueue';
import { generateThumb } from './routes/thumbs';

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
const express = require('express') as typeof import('express');

// ── Async-Handler absichern ─────────────────────────────────────────────────
// Express 4 kennt keine Promises: Wirft ein `async (req, res) => …`-Handler,
// landet die Rejection nirgends — die Antwort bleibt aus, die Verbindung offen.
// Ein Reverse-Proxy davor wartet auf sein Timeout und liefert dann 502. Genau
// so verhielt sich /api/sets/import/csv/status, während alle anderen Routen
// normal antworteten.
//
// 22 Handler hatten kein try/catch. Statt sie einzeln zu umschliessen (und die
// nächste neue Route wieder zu vergessen), wird `express.Router` hier EINMAL
// erweitert: Gibt ein Handler ein Promise zurück, hängt sich ein .catch(next)
// daran. Damit greift das zentrale Fehler-Sicherheitsnetz weiter unten, und aus
// einem stillen Hänger wird eine saubere 500.
//
// Muss vor den require('./routes/…')-Aufrufen stehen, sonst sind die Router
// bereits gebaut.
const _Router = express.Router;
function _wrapAsync(fn: any) {
  if (typeof fn !== 'function' || fn.length >= 4) return fn;   // Fehler-Middleware unangetastet
  const wrapped = function (req: any, res: any, next: any) {
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
    //
    // VORHER stand hier ein exakter Stringvergleich auf den Accept-Header.
    // Schickt ein Client `text/event-stream, */*` — was OkHttp auf Android je
    // nach Konfiguration tut —, griff die Ausnahme nicht: compression puffert
    // dann den Strom, und die Events erreichen den Client erst beim
    // Verbindungsende. Das sähe exakt wie das Problem aus, das der persistente
    // Stream lösen sollte, und wäre entsprechend schwer zu finden.
    //
    // Zwei Prüfungen statt einer: der Accept-Header als Teilstring (deckt jede
    // Kommaliste ab) UND der bereits gesetzte Content-Type der Antwort (greift
    // auch, wenn der Client gar kein Accept schickt).
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
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // 'unsafe-inline' ist entfallen: Sämtliche Inline-Handler sind durch den
    // delegierten Dispatcher in js/11-actions.js ersetzt (data-click,
    // data-change, …). Damit greift die CSP jetzt tatsächlich als zweite
    // Verteidigungslinie — bei einer übersehenen XSS-Lücke würde eingeschleustes
    // <script> nicht mehr ausgeführt.
    //
    // style-src behält 'unsafe-inline': Die Templates setzen an vielen Stellen
    // style="…" für berechnete Werte (Fortschrittsbalken, Farbpunkte). Das ist
    // eine deutlich harmlosere Klasse als ausführbares Skript und wäre ein
    // eigener Umbau.
    // cdnjs ist entfallen: Die CSP erlaubte damit JEDES Skript auf cdnjs —
    // eine Bibliothek dort zu kompromittieren hätte gereicht, um beliebigen
    // Code in dieser App auszuführen. Die einzige Nutzung (qrcodejs, 20 KB)
    // liegt jetzt unter public/vendor/qrcode/ und wird vom eigenen Origin
    // geladen; damit ist script-src wieder ausschliesslich 'self'.
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

// Hinter einem TLS-terminierenden Reverse-Proxy (Docker/nginx/traefik/caddy)
// muss Express dem X-Forwarded-Proto vertrauen, sonst wird das secure-Cookie
// nie gesetzt (Express hält die Verbindung fälschlich für HTTP).
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ── Doppelte Schrägstriche im Pfad zusammenfassen ───────────────────────────
//
// Hier standen ZWEI Middlewares hintereinander, die beide dasselbe taten. Die
// erste kürzte nur führende Schrägstriche und war damit vollständig von der
// zweiten abgedeckt — sie ist entfallen.
//
// `//api/img-proxy?url=…` trifft in Express NICHT auf `/api/img-proxy`. Die
// Anfrage fällt stattdessen durch bis zum SPA-Catch-all und bekommt
// index.html — mit **Status 200** und `text/html`. Im Browser ist das eine
// weisse Seite, im Server-Log steht nichts, und der Bild-Cache bleibt leer.
//
// Genau dieses Bild war bei einzelnen Bildern zu sehen und hat mehrere Runden
// Fehlersuche gekostet: Der Proxy schien zu antworten, tat es aber nie.
//
// Ein doppelter Schrägstrich entsteht schnell — beim Zusammensetzen einer
// Basis-URL mit abschliessendem Schrägstrich und einem Pfad, der mit einem
// beginnt. Statt jede Aufrufstelle zu prüfen, wird der Pfad hier einmal
// normalisiert.
app.use((req, _res, next) => {
  if (req.url.startsWith('//') || req.url.includes('//', 1)) {
    const [pathPart, ...rest] = req.url.split('?');
    const cleaned = pathPart.replace(/\/{2,}/g, '/');
    if (cleaned !== pathPart) req.url = cleaned + (rest.length ? '?' + rest.join('?') : '');
  }
  next();
});

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

app.use(session({
  // PostgreSQL session store — required for cluster mode so all workers share sessions.
  // Falls back gracefully if the session table doesn't exist yet (initSchema creates it).
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,  // table created in initSchema to avoid race condition
    pruneSessionInterval: 60 * 15,
    errorLog: (err) => {
      if (!err.message?.includes('timeout') && !err.message?.includes('terminated')) {
        console.error('[session-store]', err.message);
      }
    },
  }),
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

// Helper: serve a file under /data/... with session auth
// resolveUserId kommt aus utils/auth.js — nutzt den Token-Cache, statt pro
// Request die api_tokens-Tabelle zu befragen.
const { resolveUserId } = require('./utils/auth') as typeof import('./utils/auth');
// Pfade zentral — NICHT aus __dirname ableiten, siehe utils/appPaths.ts.
const { APP_ROOT, DATA_DIR, PUBLIC_DIR, IMAGES_DIR } = require('./utils/appPaths') as typeof import('./utils/appPaths');

// Path-Traversal-Schutz: Segmente wie ".." oder absolute Pfade könnten sonst
// aus dem data/-Verzeichnis ausbrechen (z.B. /data/uploads/..%2f..%2fserver.js).
// Wir prüfen deshalb, dass der aufgelöste Pfad innerhalb des Basis-Verzeichnisses bleibt.
function safeDataPath(subDir, segments) {
  if (segments.some(s => s === '..' || s === '.' || s.includes('\0'))) return null;
  const baseDir  = path.resolve(DATA_DIR, subDir);
  const filePath = path.resolve(baseDir, ...segments);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) return null;
  return filePath;
}

/**
 * Ausliefern einer Datei unter data/<subDir>/<benutzer-id>/…
 *
 * ── Wer darf das lesen? ─────────────────────────────────────────────────────
 * Hier stand `parseInt(segments[0]) !== userId` — also „nur deine eigene ID".
 * Das war richtig, solange ein Konto für sich allein stand, und passte nach dem
 * Haushalt an zwei Stellen nicht mehr:
 *
 *   • Das Hauptkonto SIEHT die Anleitung eines Unterkontos (getSet listet sie
 *     mit user_id = ANY(uids), also haushaltsweit) — und lief beim Klick in
 *     ein 403. Sichtbar, aber nicht zu öffnen.
 *   • Nach dem Verschieben eines Sets gehört die Anleitungs-Zeile dem neuen
 *     Konto, ihr local_path zeigt aber weiter in den Ordner des alten
 *     (moveSetBetweenAccounts kopiert den Pfad wörtlich). Das Hauptkonto
 *     bekam also für seine EIGENE Zeile 403.
 *
 * Deshalb entscheidet jetzt scopeIds() — dieselbe Stelle, die überall sonst
 * beantwortet, wessen Daten jemand sehen darf. Die Benutzer-ID im Pfad ist
 * damit das, was sie ohnehin schon war: eine Ablagestruktur, keine
 * Zugriffsregel. Die Regel steht in utils/household.ts.
 *
 * Die Asymmetrie bleibt gewahrt: Ein Unterkonto hat nur sich selbst im
 * Blickfeld (resolveHousehold: memberIds = [self, …eigene Subs]), kommt also
 * NICHT an die Uploads des Hauptkontos. Geprüft wird weiterhin gegen eine
 * Liste erlaubter IDs, nicht gegen „irgendwer im System".
 */
function serveDataFile(subDir) {
  return async (req, res) => {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).send('Nicht angemeldet');
    const segments = req.params[0].split('/').filter(Boolean);
    const besitzer = segments[0] ? parseInt(segments[0]) : NaN;
    if (Number.isFinite(besitzer) && besitzer !== userId && !req.session?.isAdmin) {
      const { scopeIds } = require('./utils/household') as typeof import('./utils/household');
      const erlaubt = await scopeIds(userId).catch(() => [userId]);
      if (!erlaubt.includes(besitzer)) return res.status(403).send('Kein Zugriff');
    }
    const filePath = safeDataPath(subDir, segments);
    if (!filePath) return res.status(404).send('Datei nicht gefunden');
    // Kein fs.existsSync mehr (blockiert den Event-Loop) — sendFile prüft
    // die Existenz selbst; wir mappen den Fehler nur auf 404.
    res.sendFile(filePath, err => {
      if (err && !res.headersSent) res.status(404).send('Datei nicht gefunden');
    });
  };
}

// Geteilte Bauanleitungen.
//
// data/instructions/ enthält ausschliesslich benutzerübergreifende PDFs —
// benutzereigene Anleitungen liegen unter data/uploads/<benutzer-id>/. Deshalb
// KEIN serveDataFile(): dessen Prüfung des ersten Pfadsegments gegen die
// Benutzer-ID kann hier nie passen.
app.get('/data/instructions/*', async (req, res) => {
  const userId = await resolveUserId(req);
  if (!userId) return res.status(401).send('Nicht angemeldet');
  const segments = req.params[0].split('/').filter(Boolean);
  const filePath = safeDataPath('instructions', segments);
  if (!filePath) return res.status(404).send('Datei nicht gefunden');
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) res.status(404).send('Datei nicht gefunden');
  });
});
// Bild-Proxy: eigene Datei (routes/imgProxy.ts).
//
// Der Block stand hier als ~440 Zeilen zwischen Session-Aufbau und
// Cluster-Orchestrierung. server.ts ist dadurch von 1242 auf gut 800 Zeilen
// geschrumpft und beschreibt jetzt wieder nur noch Aufbau und Start.
require('./routes/imgProxy').registerImgProxy(app);

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

// ── Alle Bilder: Sets, Teile, Minifiguren ───────────────────────────────────
//
// EINE authentifizierte Route für den gesamten Baum unter data/images/.
//
// VORHER war das zweigeteilt: Teile- und Figurenbilder liefen über eine eigene
// Route mit Anmeldepflicht, Set-Bilder dagegen über express.static — also ohne.
// Die Begründung dafür lautete, es seien öffentliche Katalogfotos. Das stimmt
// für das einzelne Bild, nicht für die Sammlung: Wer die Adressen durchprobiert,
// liest ab, WELCHE Sets jemand besitzt. Der Bestand ist das Schützenswerte,
// nicht das Foto.
//
// Zwei Dinge kann diese Route, die express.static nicht konnte:
//   1. Anmeldung verlangen.
//   2. Heilen. Fehlt die lokale Datei, wird die CDN-Adresse aus dem Katalog
//      gesucht und über den Bild-Proxy ausgeliefert — sonst wären verwaiste
//      image_local-Einträge tote Bilder.
//
// Der Platzhalter (set-placeholder.svg) liegt bewusst NICHT hier, sondern unter
// /assets/: Er ist ein Build-Asset wie CSS und JavaScript und hat mit dem
// Bestand nichts zu tun.
app.get('/images/*', async (req, res) => {
  // Session ODER Bearer-Token (Android) — läuft über den gemeinsamen Token-Cache
  const imgUserId = await resolveUserId(req);
  if (!imgUserId) return res.status(401).send('Nicht angemeldet');

  const segments = req.params[0].split('/').filter(Boolean);
  const filePath = safeDataPath('images', segments);
  if (!filePath) return res.status(404).send('Datei nicht gefunden');

  // Privat, nicht public: Die Antwort hängt an einer Anmeldung und darf nicht
  // in einem geteilten Zwischenspeicher (Reverse-Proxy, CDN) landen.
  //
  // no-cache statt max-age=604800 (Nachtrag 37, Marcos Anforderung: „wenn ein
  // falsches Bild heruntergeladen wurde, soll geprüft werden, ob ein neues auf
  // dem Server vorhanden ist"). „no-cache" heisst NICHT „nicht
  // zwischenspeichern", sondern „vor jeder Verwendung rückfragen" — der Client
  // behält seine Kopie und stellt eine BEDINGTE Anfrage.
  //
  // Vorher galt eine Woche ohne jede Rückfrage: Ein einmal geladenes falsches
  // oder veraltetes Bild blieb sieben Tage stehen, auch wenn der Server längst
  // ein neues hatte (Bild-Nachlauf, erneuter Katalog-Download, ausgetauschte
  // Datei). Genau das war beobachtet worden.
  //
  // Teuer wird das nicht: express beantwortet die bedingte Anfrage über den
  // ETag mit 304 und ohne Rumpf, solange sich die Datei nicht geändert hat.
  // Der ETag von sendFile leitet sich aus Grösse und Änderungszeit ab und
  // wechselt damit genau dann, wenn die Datei neu geschrieben wurde.
  res.setHeader('Cache-Control', 'private, no-cache');

  res.sendFile(filePath, async err => {
    if (!err || res.headersSent) return;

    // Fehlt eine VORSCHAU, gibt es fast immer das Original daneben — dann geht
    // das raus, sofort (Nachtrag 40, Marcos Anforderung: „Der Client soll das
    // Bild jeweils direkt erhalten und nicht warten, bis das Thumbs-Image
    // generiert wurde. Ist kein Thumb vorhanden, soll das grosse Bild
    // zurückgeliefert werden.").
    //
    // Der Bild-Proxy hält es für CDN-Bilder längst so: Original sofort,
    // Verkleinerung in der Warteschlange. Die lokale Route tat es nicht — sie
    // sprang bei fehlender _thumb-Datei gleich zum CDN-Umweg oder endete in
    // 404, obwohl das grosse Bild einen Ordner weiter lag. Das trifft genau
    // das Zeitfenster nach dem Erfassen: Die Vorschau entsteht im Hintergrund
    // (setImmediate → generateThumb), und wer in diesen Sekunden die Galerie
    // öffnet, bekam nichts.
    //
    // Absichtlich KEIN Erzeugen der Vorschau hier: Das würde die Anfrage um
    // rund 150 ms Jimp verlängern — bei einer Kachelwand summiert sich das zu
    // Sekunden. Die Vorschau kommt vom Hintergrundlauf; bis dahin ist das
    // Original das bessere Bild als gar keines.
    const thumbTreffer = /_thumb(\.[^.]+)$/.exec(req.params[0]);
    if (thumbTreffer) {
      const originalSegs = req.params[0].replace(/_thumb(\.[^.]+)$/, '$1').split('/').filter(Boolean);
      const originalPfad = safeDataPath('images', originalSegs);
      if (originalPfad && fs.existsSync(originalPfad)) {
        // Fehlende Vorschau im HINTERGRUND nachziehen (Nachtrag 48).
        //
        // Bis hierher war die Vorschau ein reines Erfassungs-Ereignis: erzeugt
        // wird sie nur in routes/sets.ts direkt nach dem Download. Ging dabei
        // etwas schief — bei Marcos Set scheiterte der Download bis Nachtrag 47
        // an der Grössengrenze —, entstand sie NIE mehr. Der Bilder-Nachlauf
        // half nicht: Er deckt set_parts_catalog, set_minifigs_catalog und
        // parts ab, aber NICHT `sets`, und er repariert ohnehin nur physisch
        // fehlende Dateien, keine fehlenden Vorschauen. Ergebnis: Die Galerie
        // lieferte für dieses Set dauerhaft das grosse Bild, während ältere
        // Sets ihre Vorschau nutzten — genau die gemeldete Beobachtung.
        //
        // Diese Stelle ist der beste Ort dafür: Hier ist gerade bewiesen, dass
        // die Vorschau fehlt und das Original vorliegt. Bewusst NICHT im
        // Anfragepfad erzeugen (das kostete rund 150 ms Jimp je Kachel, siehe
        // Nachtrag 40) — angestossen wird nebenher, ausgeliefert wird sofort
        // das Original. Beim nächsten Laden steht die Vorschau bereit.
        const webPfadOriginal = '/images/' + originalSegs.join('/');
        setImmediate(() => {
          try {
            require('./routes/thumbs').generateThumb(webPfadOriginal).catch(() => {});
          } catch (_) {}
        });
        return res.sendFile(originalPfad, err2 => {
          if (err2 && !res.headersSent) res.status(404).send('Datei nicht gefunden');
        });
      }
    }

    // Lokale Datei fehlt -> CDN-Adresse aus dem Katalog holen und dorthin
    // umleiten (über den Bild-Proxy, der die Hotlink-Kopfzeilen setzt). Heilt
    // Web und Android, ohne dass verwaiste image_local-Einträge in der
    // Datenbank bereinigt werden müssen.
    const webPath = '/images/' + segments.join('/');
    const cdn = await lookupCdnForMissingImage(webPath).catch(() => null);
    if (cdn && !res.headersSent) {
      return res.redirect(302, '/api/img-proxy?url=' + encodeURIComponent(cdn));
    }
    if (!res.headersSent) res.status(404).send('Datei nicht gefunden');
  });
});

app.get('/data/uploads/*',      serveDataFile('uploads'));

// Kein express.static für /images mehr.
//
// VORHER lieferte `app.use('/images', express.static(IMAGES_DIR))` die
// Set-Bilder OHNE Anmeldung aus — mit der Begründung, es seien ohnehin
// öffentliche Katalogfotos. Das stimmt für das einzelne Bild, nicht für die
// Sammlung: Wer die Adressen durchprobiert, liest ab, WELCHE Sets jemand
// besitzt. Genau das ist der schützenswerte Teil.
//
// Alle Bilder laufen jetzt über die authentifizierte Route weiter oben. Sie
// kann zusätzlich das, was express.static nicht konnte: bei fehlender lokaler
// Datei auf die CDN-Adresse aus dem Katalog umleiten.
//
// Das einzige Bild, das ohne Anmeldung erreichbar bleiben muss, ist der
// Platzhalter — er ist ein Build-Asset wie CSS und JavaScript und liegt
// deshalb jetzt unter /assets/ statt unter /images/.

app.use(express.static(PUBLIC_DIR, {
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

// Public: startup status (no auth — needed before login)
app.get('/api/startup-status', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // First check in-memory state (most current for this worker)
  const mem = global.startupStatus;
  if (mem?.ready) return res.json(mem);

  // Try DB for cross-worker state
  try {
    const db2 = require('./db/database');
    const row = await db2.get(`SELECT value FROM global_settings WHERE key='startup_status'`).catch(() => null);
    if (row?.value) {
      const status = JSON.parse(row.value);
      global.startupStatus = status;
      return res.json(status);
    }
  } catch(_) {}

  // Fallback to in-memory or default
  res.json(mem || { ready: false, step: 'Starte…', progress: 0, total: 6 });
});

// Public: health check with DB pool stats
app.get('/api/health', (req, res) => {
  const db = require('./db/database');
  const { getPoolStats } = db;
  const pool = getPoolStats ? getPoolStats() : {};
  res.json({
    status: global.startupStatus?.ready ? 'ok' : 'starting',
    startup: global.startupStatus,
    db_pool: pool,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

app.use('/api/auth',     require('./routes/auth') as typeof import('./routes/auth'));
app.use('/api/sets',     require('./routes/sets') as typeof import('./routes/sets'));
app.use('/api/parts',    require('./routes/parts') as typeof import('./routes/parts'));
app.use('/api/finance',  require('./routes/finance') as typeof import('./routes/finance'));
app.use('/api/settings', require('./routes/settings') as typeof import('./routes/settings'));
app.use('/api/minifigs', require('./routes/minifigs') as typeof import('./routes/minifigs'));
app.use('/api/v1',       require('./routes/api_v1/index') as typeof import('./routes/api_v1/index'));

// Nur ausserhalb von production erreichbar — der Endpoint feuert echte
// BrickLink-Calls und gehört nicht in eine laufende Installation.
app.get('/api/debug/test', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ success: false, error: 'Endpoint nicht gefunden' });
  if (!req.session?.userId) return res.json({ error: 'Nicht angemeldet' });
  try {
    const data = await bricklinkRequest('GET', '/items/set/75192-1');
    res.json({ success: true, data });
  // Diese Diagnoseroute ist ohnehin nur ausserhalb von Produktion erreichbar
  // (siehe 404 oben), die Detailausgabe ist hier also gewollt und harmlos.
  } catch (e) { res.json({ success: false, error: e.message, detail: e.detail || null }); }
});

// ── E-Mail Bestätigung: /verify?token=... ─────────────────────────────────────
// Der Link in der Bestätigungs-Mail zeigt hierher.
// Wir leiten direkt an den Auth-Handler weiter.
app.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/?verified=invalid');
  try {
    const db   = require('./db/database');
    const { hashToken } = require('./utils/auth') as typeof import('./utils/auth');
    // verification_token liegt seit dem Token-Hardening nur noch als SHA-256
    // in der DB — hier genauso nachschlagen wie in routes/auth.ts.
    const user = await db.get(
      "SELECT id FROM users WHERE verification_token = $1 AND token_expires > NOW() AND email_verified = 0",
      [hashToken(String(token))]
    );
    if (!user) return res.redirect('/?verified=invalid');
    await db.run(
      'UPDATE users SET email_verified=1, verification_token=NULL, token_expires=NULL WHERE id=$1',
      [user.id]
    );
    res.redirect('/?verified=1');
  } catch (e) {
    console.error('Verify error:', e.message);
    res.redirect('/?verified=invalid');
  }
});

// ── Passwort zurücksetzen: /reset-password?token=... ──────────────────────────
// Explizit registriert damit location.pathname === '/reset-password' stimmt.
app.get('/reset-password', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── 404 für unbekannte API-Pfade ────────────────────────────────────────────
// MUSS vor dem SPA-Catch-all stehen. Vorher war es umgekehrt: app.get('*') hat
// jeden unbekannten GET auf /api abgefangen und die ~189 KB grosse index.html
// mit Status 200 ausgeliefert. Für die Android-App hiess das, dass ein
// Tippfehler im Pfad als Serialisierungsfehler ankam statt als 404 — und jeder
// Retry hat die komplette HTML-Seite übertragen.
// Alle echten /api-Routen (inkl. img-proxy und debug/test) sind weiter oben
// registriert und damit nicht betroffen.
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Endpoint nicht gefunden' }));

app.get('*', async (req, res) => {
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
app.use((err, req, res, next) => { _handleRouteError(res, err); });

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

async function electPrimaryWorker(db) {
  try {
    // Den Advisory-Lock auf einer DEDIZIERTEN Verbindung halten, die NICHT in
    // den Pool zurückgegeben wird. Sonst schliesst der Pool die Session beim
    // Idle-Timeout (PG_IDLE_MS) und gibt damit den Session-Lock frei — dann
    // könnten sich mehrere Worker gleichzeitig für "primary" halten und
    // Hintergrund-Jobs (z. B. der Bild-Download) liefen mehrfach parallel.
    const client = await db.pool.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok',
      [require('./utils/lockNamespaces').LOCKS.PRIMARY_WORKER]);
    isPrimaryWorker = !!rows[0]?.ok;
    if (isPrimaryWorker) {
      _primaryLockClient = client;                 // offen halten → Lock bleibt bestehen
      client.on('error', () => { isPrimaryWorker = false; _primaryLockClient = null; });
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
  // ── Geordnetes Herunterfahren ─────────────────────────────────────────────
  //
  // Ohne SIGTERM-Handler beendet `docker compose down` (oder jedes Deploy) den
  // Prozess hart: Laufende Anfragen brechen mitten in der Antwort ab, offene
  // SSE-Verbindungen bekommen kein Ende, und ein CSV-Import wird zwischen zwei
  // Statements gekappt. Zusammen mit den (jetzt vorhandenen) Transaktionen
  // heisst geordnetes Beenden auch: keine halb geschriebenen Bestände mehr.
  //
  // Ablauf: keine neuen Verbindungen mehr annehmen → laufende zu Ende bringen →
  // Datenbankpool und LISTEN-Verbindung schliessen. Die Frist ist bewusst
  // kürzer als Dockers Standard-Gnadenfrist von 10 s, damit wir vor dem
  // SIGKILL fertig sind.
  const SHUTDOWN_TIMEOUT_MS = 8000;
  let shuttingDown = false;

  async function shutdown(signal) {
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
      const beendet = require('./utils/sseRegistry').closeAllSse();
      if (beendet) console.log(`[shutdown] ${beendet} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
      await require('./utils/pgNotify').close().catch(() => {});
      await require('./db/database').pool.end().catch(() => {});
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

  global._enableLogPersistence(require('./db/database').pool);
  global.startupStatus = { ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 };
  const csvSync = require('./jobs/rebrickableCsvSync');

  await electPrimaryWorker(db);

  // Only primary worker clears stale startup_status — secondaries read it from DB
  if (isPrimaryWorker) {
    await db.run(`DELETE FROM global_settings WHERE key='startup_status'`).catch(() => {});
  }

  (async () => {
    if (isPrimaryWorker) {
      try {
        await csvSync.run();
      } catch(e) {
        console.error('[rb-csv-sync] startup error:', e.message);
        global.startupStatus = { ready: true, step: 'Fehler beim CSV-Import', progress: 6, total: 6 };
      }
    } else {
      // Non-primary workers wait for primary to finish startup sync
      while (true) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const row = await db.get(`SELECT value FROM global_settings WHERE key='startup_status'`).catch(() => null);
          if (row?.value) {
            const s = JSON.parse(row.value);
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
  const scheduler = require('./jobs/dailyScheduler');
  scheduler.register('brickset_retry', () =>
    require('./jobs/bricksetRetry').processRetryQueue().catch(e => console.error('[brickset-retry]', e.message)));
  scheduler.register('csv_sync', () =>
    db.run("DELETE FROM global_settings WHERE key='rb_csv_last_sync'")
      .then(() => csvSync.run())
      .catch(e => console.error('[rb-csv-sync daily]', e.message)));
  scheduler.startTriggerPoll();

  // CSV-Sync auf Zuruf statt im 5-Sekunden-Takt.
  // Der Eintrag in global_settings bleibt die belastbare Quelle; das
  // NOTIFY-Signal weckt nur sofort. Beim Verbinden prüft der Handler den
  // Eintrag einmal von sich aus, sodass ein während einer Trennung verpasstes
  // Signal nachgeholt wird (siehe utils/pgNotify.ts).
  let _csvSyncRunning = false;
  require('./utils/pgNotify').listen('csv_sync_trigger', async () => {
    if (_csvSyncRunning) return;
    try {
      const row = await db.get(`SELECT value FROM global_settings WHERE key='csv_sync_trigger'`).catch(() => null);
      if (!row?.value) return;
      await db.run(`DELETE FROM global_settings WHERE key='csv_sync_trigger'`).catch(() => {});
      console.log('[rb-csv-sync] Manual trigger received — starting CSV sync');
      _csvSyncRunning = true;
      await db.run("DELETE FROM global_settings WHERE key='rb_csv_last_sync'").catch(() => {});
      await csvSync.run().catch(e => console.error('[rb-csv-sync manual]', e.message));
    } catch(_) {}
    finally { _csvSyncRunning = false; }
  });

  // Background image download: 30s after startup, then every hour
  (function scheduleImageDownloads() {
    const run = async () => {
      try {
        const enrich  = require('./jobs/partsCatalogEnrich');
        const monitor = require('./utils/jobMonitor');
        const sets = await db.all(
          `SELECT DISTINCT set_number FROM set_parts_catalog
           WHERE image_url IS NOT NULL AND image_local IS NULL
           UNION
           SELECT DISTINCT set_number FROM set_minifigs_catalog
           WHERE image_url IS NOT NULL AND image_local IS NULL`
        ).catch(() => []);
        // Manuell erfasste Teile mit fehlendem lokalen Bild — im selben Job
        // dauerhaft in den lokalen Cache laden (statt nur über den Proxy).
        const manualParts = await db.all(
          `SELECT user_id, part_number, color_id, image_url FROM parts
           WHERE source='manual' AND image_url IS NOT NULL AND image_local IS NULL`
        ).catch(() => []);
        // Minifiguren — ALLE, nicht nur manuell erfasste.
        //
        // Bisher stand hier `source='manual'`. Minifiguren aus Sets liefen
        // dadurch dauerhaft über /api/img-proxy: Anmeldeprüfung, Cache-Suche
        // und Stream bei jeder einzelnen Kachel, beim ersten Anzeigen dazu ein
        // CDN-Roundtrip je Bild. Set-Bilder liegen längst lokal und gehen über
        // express.static — deshalb war die Minifiguren-Ansicht spürbar träger.
        //
        // DISTINCT über die Nummer: Die Datei heisst nach der Figur und wird
        // von allen Nutzern geteilt, sie muss also nur einmal geholt werden.
        const figsToFetch = await db.all(
          `SELECT DISTINCT ON (fig_number) fig_number, image_url FROM minifigs
            WHERE image_url IS NOT NULL AND image_local IS NULL
            ORDER BY fig_number`
        ).catch(() => []);
        if (!sets.length && !manualParts.length && !figsToFetch.length) {
          await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht', label: '📥 Bild-Download (CDN)' }).catch(() => {});
          return;
        }
        console.log(`[img-dl-bg] fehlende Bilder: ${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`);
        await monitor.update('imgDl', { status: 'running', progress: 0,
          total: sets.length + manualParts.length + figsToFetch.length,
          sub: `${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`,
          label: '📥 Bild-Download (CDN)' }).catch(() => {});
        let done = 0;
        const total = sets.length + manualParts.length + figsToFetch.length;
        const tick = async () => {
          done++;
          if (done % 10 === 0 || done === total) {
            await monitor.update('imgDl', { status: 'running', progress: done, total,
              sub: `${done} / ${total} geladen`, label: '📥 Bild-Download (CDN)' }).catch(() => {});
          }
        };
        for (const { set_number } of sets) {
          await enrich.downloadSetImages(set_number).catch(e => console.warn(`[img-dl-bg] ${set_number}: ${e.message}`));
          await tick();
        }
        for (const p of manualParts) {
          const local = await enrich.downloadImage(p.image_url, p.part_number, p.color_id || 0, 'part').catch(() => null);
          if (local) {
            await db.run(
              "UPDATE parts SET image_local=$1 WHERE user_id=$2 AND part_number=$3 AND color_id=$4 AND source='manual'",
              [local, p.user_id, p.part_number, p.color_id || 0]
            ).catch(() => {});
            // Fehlte bisher: Ohne diesen Aufruf blieb es bei der Originalgrösse,
            // dauerhaft — anders als bei Sets (downloadSetImages() oben), wo
            // die Vorschau schon immer angestossen wurde. Der einmalige
            // Startup-Job weiter unten ("Generate missing thumbnails") hätte
            // das irgendwann nachgeholt, aber erst beim NÄCHSTEN
            // Server-Neustart — nicht wenn das Bild gerade frisch da ist.
            generateThumb(local).catch(() => {});
          }
          await tick();
        }
        for (const f of figsToFetch) {
          const local = await enrich.downloadImage(f.image_url, f.fig_number, 0, 'minifig').catch(() => null);
          if (local) {
            // Alle Zeilen dieser Figur setzen — über Nutzer und Quellen hinweg.
            // Die Datei ist dieselbe, sie heisst nach der Nummer.
            await db.run(
              'UPDATE minifigs SET image_local=$1 WHERE fig_number=$2 AND image_local IS NULL',
              [local, f.fig_number]
            ).catch(() => {});
            // Dieselbe fehlende Vorschau-Erzeugung wie bei den Teilen oben.
            generateThumb(local).catch(() => {});
          }
          await tick();
        }
        await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht', label: '📥 Bild-Download (CDN)' }).catch(() => {});
      } catch(e) { console.error('[img-dl-bg] error:', e.message); }
    };
    setTimeout(() => run().finally(() => setInterval(run, 60 * 60 * 1000)), 30_000);
  })();

}).catch(err => {
  console.error('❌ Database initialisation failed:', err.message);
  console.error('   Check PostgreSQL connection settings (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
  process.exit(1);
});

} // end cluster worker block
