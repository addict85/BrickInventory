/**
 * Image proxy: delivery, caching, diagnosis.
 *
 * Counter-checks for the cases moved to image-proxy-deckel.test.js (type check, placeholder)
 * and img-cache-serve.test.js (304) stand there; for 304 each
 * the `req.fresh` line removed in src/images/http/imageCacheDelivery.ts → red there
 * “known state → 304 and NO image” (08.11.2026). Double slashes
 * in the path → sicherheit-querschnitt-db I (normalization removed → red there).
 * Counters and log of the failures, content check of the probe →
 * image-proxy-deckel.test.js I and J.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abschnitt } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
// The image proxy moved from server.ts to routes/imgProxy.ts (server.ts
// had become a small monolith again with over 1200 lines of proxy, thumb queue,
// cluster setup and startup orchestration). The facts checked here
// apply unchanged — they are just spread over two files now:
const SERVER_ONLY = require('./helpers/sources').startSource();
const PROXY = require('./helpers/sources').proxyThumbSource();
const SERVER = SERVER_ONLY + '\n' + PROXY;
const CODE = SERVER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('concurrent requests write into separate temp files', () => {
  // The name only contained the process ID. If a tile wall requests the same image
  // several times at once, all requests of the same worker wrote into
  // THE SAME file — measured 418'603 instead of 81'920 bytes, i.e. five copies
  // one after another. Such files start with FFD8 and end with FFD9, but the
  // browser cannot decode them.
  assert.match(
    SERVER,
    /const tmpFile = `\$\{cacheFile\}\.tmp-\$\{process\.pid\}-\$\{randomUUID\(\)\}`/,
    'Der Temp-Name braucht einen eigenen Teil je Anfrage',
  );
});

test('only complete files get into the cache', () => {
  // A truncated file would be delivered permanently: the browser gets
  // 200 but cannot decode the image.
  assert.match(
    SERVER,
    /const expected = parseInt\(String\(r\.head\['content-length'\]/,
    'Die erwartete Länge muss gemerkt werden',
  );
  // After unpacking the announced length no longer fits — then the check
  // is dropped (see “compressed responses are unpacked").
  assert.match(
    SERVER,
    /if \(!enc && expected > 0 && st\.size !== expected\)/,
    'Vor dem Umbenennen muss die Grösse geprüft werden',
  );
});

test('the cache stream hangs in front of the client stream', () => {
  // r.pipe(ws) once stood behind an `await mkdir`. r.pipe(res) runs
  // synchronously before it — the first chunks thus flowed to the client before the
  // cache stream was even attached.
  // The cache branch stands in intoCache(); there up to body.pipe(ws), then in the
  // caller from the call up to body.pipe(res).
  const start = CODE.indexOf("const rawType = String(r.head['content-type']");
  const blk = CODE.slice(start, CODE.indexOf('body.pipe(res);', start) + 20);
  const iCache = blk.indexOf('intoCache(d, body'),
    iClient = blk.indexOf('body.pipe(res)');
  assert.ok(iCache > 0 && iClient > iCache, 'intoCache(body …) muss vor body.pipe(res) stehen');
  const cache = CODE.slice(CODE.indexOf('function intoCache('), CODE.indexOf('body.pipe(ws)'));
  assert.ok(cache.length > 0 && CODE.indexOf('function intoCache(') > 0, 'body.pipe(ws) steht nicht in intoCache()');
  assert.doesNotMatch(
    blk.slice(0, iCache) + cache,
    /await /,
    'Zwischen Antwortbeginn und Cache-Stream darf kein await liegen',
  );
});

test('compressed responses are decompressed, not passed on', () => {
  // A passed-through compressed body with Content-Type: image/jpeg
  // yields a white area in the browser — with status 200 and matching
  // length, i.e. without any hint in the log. Unpacking also makes the
  // stored file a real image, independent of everything before.
  assert.match(SERVER, /'Accept-Encoding': 'identity'/, 'Unkomprimiert anfordern ist die erste Verteidigungslinie');
  const idents = (SERVER.match(/'Accept-Encoding': 'identity'/g) || []).length;
  assert.equal(idents, 2, 'Beide Kopfzeilen-Sätze müssen identity anfordern');

  assert.match(SERVER, /enc === 'gzip' \? zlib\.createGunzip\(\)/, 'gzip wird nicht entpackt');
  assert.match(SERVER, /enc === 'br' \? zlib\.createBrotliDecompress\(\)/, 'brotli wird nicht entpackt');
  assert.match(
    SERVER,
    /res\.removeHeader\('Content-Length'\)/,
    'Nach dem Entpacken stimmt die angekündigte Länge nicht mehr',
  );

  // Both targets must get the UNPACKED stream
  assert.match(SERVER, /body\.pipe\(ws\)/, 'Der Cache bekommt nicht den entpackten Strom');
  assert.match(SERVER, /body\.pipe\(res\)/, 'Der Client bekommt nicht den entpackten Strom');

  // Preview and disk cache share one place (bildCacheAuslieferung.ts;
  // behavior: img-cache-serve.test.js), plus the CDN fetch.
  const lengths = (SERVER.match(/res\.setHeader\('Content-Length'/g) || []).length;
  assert.ok(lengths >= 2, `Nur ${lengths} von zwei Stellen setzen Content-Length (Cache, CDN-Abruf)`);
});

test('aborted client requests release the CDN connection', () => {
  // Without that the socket stayed occupied: the response stream ran into a dead res,
  // back pressure control held it, and the queue starved.
  assert.match(
    SERVER,
    /res\.on\('close', \(\) => \{[\s\S]{0,400}?raw\.destroy\(\)/,
    'Der Abbruch muss die laufende CDN-Anfrage beenden',
  );
  // `!writableFinished` alone is too strict: depending on what sits between server
  // and browser, close can fire before Node has set writableFinished
  // — then a healthy transfer was shot down. The client got
  // 200 and then nothing, the cache stayed empty, nothing was logged.
  assert.match(
    SERVER,
    /if \(res\.writableFinished \|\| !res\.destroyed\) return;/,
    'res.destroyed ist der belastbare Hinweis auf einen echten Abbruch',
  );
  assert.match(
    SERVER,
    /Client hat abgebrochen, Verbindung freigegeben/,
    'Ein Abbruch muss sichtbar sein — stilles Abschiessen war die Ursache',
  );
  assert.match(
    SERVER,
    /r\.(?:verwerfen|discard)\(\);\s*r = await openCdn\(HEADER_SETS\[1\]\)/,
    'Beim Rückfall ohne Referer muss die erste Antwort freigegeben werden',
  );
});

test('the connection pool is wide enough', async () => {
  // With 8 a single opened image waited behind 60 tile requests
  // 1195 ms; with 32 it is 282 ms, without limit 153 ms.
  // The pool stands in the client (clients/imageCdn.ts), the proxy takes it with `pool: true`.
  // Counter-check (05.11.2026): maxSockets 8 in clients/imageCdn.ts → red.
  const { openImage } = require('./helpers/sources').buildAndRequire()('clients/imageCdn.js');
  const { recording } = require('./helpers/https-recording');
  const url = 'https://cdn.rebrickable.com/media/sets/1-1.jpg';
  const [withPool, withoutPool] = await recording(async () => {
    await openImage(url, { maxBytes: 1000, pool: true }).catch(() => {});
    await openImage(url, { maxBytes: 1000 }).catch(() => {});
  });
  const agent = withPool?.options.agent;
  assert.ok(agent, 'der Proxy-Abruf nimmt den Pool nicht');
  assert.ok(agent.maxSockets >= 32, `maxSockets ${agent.maxSockets} ist zu eng — Einzelabrufe warten spürbar`);
  assert.equal(agent.keepAlive, true, 'Wiederverwendung spart den TLS-Handshake');
  assert.equal(withoutPool?.options.agent, undefined, 'ein Einzelabruf hält keine Verbindung offen');
  assert.match(SERVER, /pool: true/, 'der Proxy nimmt den Pool nicht');
});

test('the diagnostic endpoints are present', () => {
  const route = require('./helpers/sources').kompakt(fs.readFileSync(path.join(ROOT, 'routes/api/admin.ts'), 'utf8'));
  assert.match(route, /router\.endpoint\('POST \/api\/v2\/admin\/img-probe', requireApiAdmin/, 'img-probe fehlt');
  assert.match(route, /router\.endpoint\('POST \/api\/v2\/admin\/price-probe', requireApiAdmin/, 'price-probe fehlt');
  // The fetches themselves stand in the administration's service (routes do not call into the network).
  const admin = fs.readFileSync(path.join(ROOT, 'src/management/diagnostics.ts'), 'utf8');
  assert.match(
    admin,
    /content_encoding: k\['content-encoding'\]/,
    'Die Probe muss zeigen, ob das CDN komprimiert liefert',
  );
  assert.match(admin, /proxy_failures: failures/, 'Die Zähler gehören in die Antwort');
});

test('broken responses are not nailed into the browser for a day', () => {
  // Observed: "200 OK (from disk cache)" — the request did not even reach the server
  // anymore. The browser kept delivering a broken response from the time of the
  // fixed bug. No log entry, no server cache, white
  // area. With `max-age=86400` without revalidation that lasts a whole day.
  assert.doesNotMatch(
    SERVER,
    /'public, max-age=86400'\s*\)/,
    'Ein langes max-age ohne must-revalidate nagelt Fehler im Browser fest',
  );

  // The streamed path does not know the content yet — keep it short there.
  const stream = SERVER.slice(
    SERVER.indexOf("const rawType = String(r.head['content-type']"),
    SERVER.indexOf('body.pipe(res);'),
  );
  assert.match(
    stream,
    /max-age=3600, must-revalidate/,
    'Frisch gestreamte Antworten dürfen nicht lange festgehalten werden',
  );

  // The cache paths deliver checked content and may last longer — but with ETag,
  // so that the browser can revalidate cheaply.
  assert.match(SERVER, /`"c-\$\{cst\.size\}-\$\{Math\.floor\(cst\.mtimeMs\)\}"`/, 'ETag für den Plattencache fehlt');
  assert.match(SERVER, /`"t-\$\{tst\.size\}-\$\{Math\.floor\(tst\.mtimeMs\)\}"`/, 'ETag für die Vorschau fehlt');
});

test('minifigure images are stored locally like set images', () => {
  // Previously the background run only loaded `source='manual'`. Minifigures from sets
  // thus permanently ran via /api/img-proxy: login check, cache search
  // and stream for every tile, at first display one CDN round trip per
  // image. Set images have long been local and go via express.static. …
  assert.match(
    SERVER,
    /SELECT mc\.fig_number, mc\.image_url FROM minifigs_catalog mc/,
    'Der Hintergrundlauf muss alle Minifiguren ohne lokales Bild finden',
  );
  assert.doesNotMatch(
    SERVER,
    /FROM minifigs\s+WHERE source='manual' AND image_url IS NOT NULL AND image_local IS NULL/,
    'Die Beschränkung auf manuelle Figuren muss weg sein',
  );
  // But only minifigures someone OWNS: the catalog also knows minifigures from
  // set parts lists nobody has — those need no local image.
  assert.match(
    SERVER,
    /EXISTS \(SELECT 1 FROM \$\{l\.figHoldings\(\)\} m WHERE m\.fig_number = mc\.fig_number\)/,
    'Der Lauf darf nicht Bilder von Figuren holen, die niemand besitzt',
  );

  // One file per number, shared across all users — and since migration 0034
  // also only ONE row pointing to it.
  assert.match(
    SERVER,
    /setMinifigImageLocal\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?f\.fig_number, local\)/,
    'Ein Download muss den Katalogeintrag der Figur setzen',
  );

  // Progress in the existing job, no second entry in monitoring
  assert.match(SERVER, /const tick = async \(\) => \{/, 'Fortschrittszähler fehlt');
  assert.match(SERVER, /text: `\$\{done\} \/ \$\{total\} geladen`/, 'Zwischenstand fehlt');
  const mon = fs.readFileSync(path.join(ROOT, 'src/management/tiles.ts'), 'utf8');
  const figJobs = (mon.match(/^\s{2}\w+:\s*\{/gm) || []).filter(l => /fig|minifig/i.test(l));
  assert.deepEqual(figJobs, [], 'Es darf kein eigener Job dafür entstehen — imgDl deckt es ab');

  // And the open amount in monitoring must count it. The query stands
  // in the service of the administration routes; the route calls it for the tile.
  const route = fs.readFileSync(path.join(ROOT, 'src/management/jobMonitor.ts'), 'utf8');
  assert.match(
    route,
    /management\.holdingMinifigImagesOpen\(\)/,
    'Die Job-Übersicht muss die Figurenbilder des Bestands abfragen',
  );
  const admin = fs.readFileSync(path.join(ROOT, 'src/management/repository/management.ts'), 'utf8');
  assert.match(
    admin,
    /COUNT\(\*\)::int AS c FROM minifigs_catalog mc/,
    'Die Minifiguren des Bestands fehlen in der offenen Menge',
  );
  // The same amount as the background run — otherwise monitoring shows a
  // number that does not fit the progress.
  assert.match(
    admin,
    /EXISTS \(SELECT 1 FROM minifigs m WHERE m\.fig_number = mc\.fig_number\)/,
    'Die offene Menge und der Hintergrundlauf müssen dieselbe Menge meinen',
  );
});

test('the cache cleanup run is a scheduled job', () => {
  // The daily cleanup once stood in registerImgProxy() and thus ran
  // in every web worker; today it is a step of the scheduled job
  // 'cleanup_daily' (src/management/cleanup.ts) and only runs in the job process.
  assert.match(
    SERVER,
    /export async function cleanImageCacheOn/,
    'Der Lauf muss von aussen startbar sein, statt beim Registrieren loszulaufen',
  );
  const reg = abschnitt(
    SERVER,
    'function registerImgProxy',
    'export async function cleanImageCacheOn',
    'Registrierung ohne tagesweites Intervall',
  );
  assert.doesNotMatch(reg, /setInterval/, 'Kein eigenes Intervall im Teil, den der Web-Prozess ausführt');
  const plan = require('./helpers/sources').ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'src/management/cleanup.ts'), 'utf8'),
  );
  assert.match(
    plan.slice(plan.indexOf('function cleanupDaily')),
    /cleanImageCacheOn\(/,
    'Der Bild-Cache gehört zum täglichen Aufräumen',
  );
});
