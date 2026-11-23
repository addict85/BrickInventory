/**
 * Image proxy: delivery, caching, diagnosis.
 *
 * Counter-checks for the cases moved to image-proxy-deckel.test.js (type check, placeholder)
 * and img-cache-serve.test.js (304) stand there; for 304 each
 * the `req.fresh` line removed in src/images/http/imageCacheDelivery.ts → red there
 * “known state → 304 and NO image” (08.11.2026). Double slashes
 * in the path → sicherheit-querschnitt-db I (normalization removed → red there).
 * Counters and log of the failures, content check of the probe →
 * image-proxy-deckel.test.js I and J. The streamed path (temp files, completeness, unpacking,
 * abort, Cache-Control): img-proxy-stream.test.js; the probes over the server: admin-probes-db.test.js;
 * minifigure images of the holding: image-follow-up-preview-db.test.js.
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
