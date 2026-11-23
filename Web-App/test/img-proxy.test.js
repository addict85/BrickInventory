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
    'The temp name needs its own part per request',
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
    'The size must be checked before renaming',
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
  assert.ok(iCache > 0 && iClient > iCache, 'intoCache(body …) must come before body.pipe(res)');
  const cache = CODE.slice(CODE.indexOf('function intoCache('), CODE.indexOf('body.pipe(ws)'));
  assert.ok(cache.length > 0 && CODE.indexOf('function intoCache(') > 0, 'body.pipe(ws) is not in intoCache()');
  assert.doesNotMatch(
    blk.slice(0, iCache) + cache,
    /await /,
    'There must be no await between the start of the response and the cache stream',
  );
});

test('compressed responses are decompressed, not passed on', () => {
  // A passed-through compressed body with Content-Type: image/jpeg
  // yields a white area in the browser — with status 200 and matching
  // length, i.e. without any hint in the log. Unpacking also makes the
  // stored file a real image, independent of everything before.
  assert.match(SERVER, /'Accept-Encoding': 'identity'/, 'Requesting uncompressed is the first line of defense');
  const idents = (SERVER.match(/'Accept-Encoding': 'identity'/g) || []).length;
  assert.equal(idents, 2, 'Both header sets must request identity');

  assert.match(SERVER, /enc === 'gzip' \? zlib\.createGunzip\(\)/, 'gzip is not unpacked');
  assert.match(SERVER, /enc === 'br' \? zlib\.createBrotliDecompress\(\)/, 'brotli is not unpacked');
  assert.match(
    SERVER,
    /res\.removeHeader\('Content-Length'\)/,
    'After unpacking the announced length is no longer correct',
  );

  // Both targets must get the UNPACKED stream
  assert.match(SERVER, /body\.pipe\(ws\)/, 'The cache does not get the unpacked stream');
  assert.match(SERVER, /body\.pipe\(res\)/, 'The client does not get the unpacked stream');

  // Preview and disk cache share one place (bildCacheAuslieferung.ts;
  // behavior: img-cache-serve.test.js), plus the CDN fetch.
  const lengths = (SERVER.match(/res\.setHeader\('Content-Length'/g) || []).length;
  assert.ok(lengths >= 2, `Only ${lengths} of two places set Content-Length (cache, CDN fetch)`);
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
    'res.destroyed is the reliable sign of a real abort',
  );
  assert.match(
    SERVER,
    /Client hat abgebrochen, Verbindung freigegeben/,
    'Ein Abbruch muss sichtbar sein — stilles Abschiessen war die Ursache',
  );
  assert.match(
    SERVER,
    /r\.(?:verwerfen|discard)\(\);\s*r = await openCdn\(HEADER_SETS\[1\]\)/,
    'On the fallback without a referer the first response must be released',
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
  assert.ok(agent, 'the proxy fetch does not take the pool');
  assert.ok(agent.maxSockets >= 32, `maxSockets ${agent.maxSockets} is too tight — single fetches wait noticeably`);
  assert.equal(agent.keepAlive, true, 'Reuse saves the TLS handshake');
  assert.equal(withoutPool?.options.agent, undefined, 'a single fetch keeps no connection open');
  assert.match(SERVER, /pool: true/, 'the proxy does not take the pool');
});

test('the diagnostic endpoints are present', () => {
  const route = require('./helpers/sources').compact(fs.readFileSync(path.join(ROOT, 'routes/api/admin.ts'), 'utf8'));
  assert.match(route, /router\.endpoint\('POST \/api\/v2\/admin\/img-probe', requireApiAdmin/, 'img-probe fehlt');
  assert.match(route, /router\.endpoint\('POST \/api\/v2\/admin\/price-probe', requireApiAdmin/, 'price-probe fehlt');
  // The fetches themselves stand in the administration's service (routes do not call into the network).
  const admin = fs.readFileSync(path.join(ROOT, 'src/management/diagnostics.ts'), 'utf8');
  assert.match(
    admin,
    /content_encoding: k\['content-encoding'\]/,
    'The probe must show whether the CDN delivers compressed',
  );
  assert.match(admin, /proxy_failures: failures/, 'The counters belong in the response');
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
  assert.match(SERVER, /`"c-\$\{cst\.size\}-\$\{Math\.floor\(cst\.mtimeMs\)\}"`/, 'ETag for the disk cache is missing');
  assert.match(SERVER, /`"t-\$\{tst\.size\}-\$\{Math\.floor\(tst\.mtimeMs\)\}"`/, 'ETag for the preview is missing');
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
    'The restriction to manual minifigs must be gone',
  );
  // But only minifigures someone OWNS: the catalog also knows minifigures from
  // set parts lists nobody has — those need no local image.
  assert.match(
    SERVER,
    /EXISTS \(SELECT 1 FROM \$\{l\.figHoldings\(\)\} m WHERE m\.fig_number = mc\.fig_number\)/,
    'The run must not fetch images of minifigs nobody owns',
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
  assert.match(SERVER, /text: `\$\{done\} \/ \$\{total\} geladen`/, 'Intermediate state is missing');
  const mon = fs.readFileSync(path.join(ROOT, 'src/management/tiles.ts'), 'utf8');
  const figJobs = (mon.match(/^\s{2}\w+:\s*\{/gm) || []).filter(l => /fig|minifig/i.test(l));
  assert.deepEqual(figJobs, [], 'No separate job may be created for it — imgDl covers it');

  // And the open amount in monitoring must count it. The query stands
  // in the service of the administration routes; the route calls it for the tile.
  const route = fs.readFileSync(path.join(ROOT, 'src/management/jobMonitor.ts'), 'utf8');
  assert.match(
    route,
    /management\.holdingMinifigImagesOpen\(\)/,
    'The job overview must query the minifig images of the stock',
  );
  const admin = fs.readFileSync(path.join(ROOT, 'src/management/repository/management.ts'), 'utf8');
  assert.match(
    admin,
    /COUNT\(\*\)::int AS c FROM minifigs_catalog mc/,
    'The minifigs of the stock are missing in the open set',
  );
  // The same amount as the background run — otherwise monitoring shows a
  // number that does not fit the progress.
  assert.match(
    admin,
    /EXISTS \(SELECT 1 FROM minifigs m WHERE m\.fig_number = mc\.fig_number\)/,
    'The open set and the background run must mean the same set',
  );
});

test('the cache cleanup run is a scheduled job', () => {
  // The daily cleanup once stood in registerImgProxy() and thus ran
  // in every web worker; today it is a step of the scheduled job
  // 'cleanup_daily' (src/management/cleanup.ts) and only runs in the job process.
  assert.match(
    SERVER,
    /export async function cleanImageCacheOn/,
    'The run must be startable from outside instead of starting on registration',
  );
  const reg = abschnitt(
    SERVER,
    'function registerImgProxy',
    'export async function cleanImageCacheOn',
    'Registrierung ohne tagesweites Intervall',
  );
  assert.doesNotMatch(reg, /setInterval/, 'No own interval in the part the web process runs');
  const plan = require('./helpers/sources').ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'src/management/cleanup.ts'), 'utf8'),
  );
  assert.match(
    plan.slice(plan.indexOf('function cleanupDaily')),
    /cleanImageCacheOn\(/,
    'Der Bild-Cache gehört zum täglichen Aufräumen',
  );
});
