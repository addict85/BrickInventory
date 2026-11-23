/**
 * The image proxy's streamed path against a local CDN (helpers/https-stub.js): what the client and the
 * disk cache get when the CDN answers in parallel, cut off, compressed or slowly.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  tmpFile without randomUUID() → red “a concurrent cut-off request …” (the cut one deletes the shared tmp)
 *   B  intoCache() deferred by setTimeout(…, 30) → red “the cache gets every byte …” (not cached)
 *   C  unpacked() without the gzip branch → red “a gzip body …” (client gets gzip)
 *   D  res.removeHeader('Content-Length') removed → red the same test (length of the compressed body)
 *   E  the second header set without 'Accept-Encoding': 'identity' → red “both attempts ask uncompressed”
 *   F  raw.destroy() removed from res.on('close') → red “an aborted client request releases …”
 *   G  the streamed path with `public, max-age=86400` → red “streamed briefly, cached with ETag”
 *   H  the discard on a body error removed (tmp renamed anyway) → red “a cut-off response …”
 *   (The size check before the rename stays green when removed: Node reports a short body as an
 *   error, so the discard path catches it first.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-imgstream-'));
process.env.APP_ROOT = root;
process.env.IMAGE_FETCHES_PER_MINUTE = '1000';
const express = require('express');
const { buildAndRequire, testData, replaceServices, testServices } = require('./helpers/sources');
const _req = buildAndRequire();
const { httpsStub } = require('./helpers/https-stub');
const { portOf } = require('./helpers/server');
const { until } = require('./helpers/time');
replaceServices('images', { setNumberInScope: async () => false });
const passThroughImage = (...a) => _req('routes/imgProxy.js').passThroughImage(testServices(), ...a);
const { proxyCacheKey } = _req('src/images/images.js');
const cacheDir = path.join(root, 'data', 'img_proxy_cache');

const app = express();
app.use((req, _res, next) => {
  /** @type {any} */ (req).session = { userId: 800000 + (process.pid % 100000) };
  next();
});
app.get('/p', passThroughImage);
const srv = app.listen(0);
const proxied = u => `http://127.0.0.1:${portOf(srv)}/p?url=${encodeURIComponent(u)}`;
const cdn = name => `https://cdn.rebrickable.com/media/parts/${name}-${process.pid}.png`;
const cached = u => path.join(cacheDir, proxyCacheKey(u));
const IMAGE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200_000, 9)]);

test.after(async () => {
  srv.close();
  await testData()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
});

test('a concurrent cut-off request does not spoil the complete one', async t => {
  const u = cdn('parallel');
  let n = 0;
  let firstArrived;
  const first = new Promise(r => (firstArrived = r));
  await httpsStub(t, (_c, res) => {
    const cut = ++n === 2;
    firstArrived();
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    // In pieces, so that both writers overlap; the second CDN response breaks off midway.
    let i = 0;
    const step = () => {
      if (cut && i >= 50_000) return res.socket?.destroy();
      if (i >= IMAGE.length) return res.end();
      res.write(IMAGE.subarray(i, i + 16_384));
      i += 16_384;
      setTimeout(step, cut ? 1 : 10);
    };
    step();
  });
  const get = () =>
    fetch(proxied(u))
      .then(async r => Buffer.from(await r.arrayBuffer()))
      .catch(() => Buffer.alloc(0));
  // The second request starts only once the first reached the CDN: under load a fixed 5 ms let the
  // second one overtake, and the "complete" client got the cut-off response.
  const [whole] = await Promise.all([get(), first.then(get)]);
  assert.ok(whole.equals(IMAGE), `client got ${whole.length} bytes`);
  assert.ok(await until(() => fs.existsSync(cached(u)), 3000), 'the complete image was not cached');
  assert.ok(fs.readFileSync(cached(u)).equals(IMAGE), `cache file has ${fs.statSync(cached(u)).size} bytes`);
});

test('the cache gets every byte, even the first chunk', async t => {
  const u = cdn('first');
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.end(IMAGE);
  });
  const r = await fetch(proxied(u));
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(IMAGE));
  assert.ok(await until(() => fs.existsSync(cached(u))), 'not cached');
  assert.equal(fs.statSync(cached(u)).size, IMAGE.length);
});

test('a gzip body is unpacked for client and cache', async t => {
  const u = cdn('gzip');
  const gz = zlib.gzipSync(IMAGE);
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-encoding': 'gzip',
      'content-length': String(gz.length),
    });
    res.end(gz);
  });
  const r = await fetch(proxied(u));
  const body = Buffer.from(await r.arrayBuffer());
  assert.equal(r.headers.get('content-encoding'), null);
  assert.notEqual(r.headers.get('content-length'), String(gz.length));
  assert.ok(body.equals(IMAGE), `client got ${body.length} bytes`);
  assert.ok(await until(() => fs.existsSync(cached(u))));
  assert.ok(fs.readFileSync(cached(u)).equals(IMAGE), 'the cache holds the compressed body');
});

test('both attempts ask uncompressed', async t => {
  const u = cdn('identity');
  const stub = await httpsStub(t, (c, res) => {
    // The hotlink protection: the first attempt (with referer) gets 404.
    if (c.headers.referer) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(IMAGE);
  });
  const r = await fetch(proxied(u));
  await r.arrayBuffer();
  assert.equal(r.status, 200);
  assert.deepEqual(
    stub.calls.map(c => [!!c.headers.referer, c.headers['accept-encoding']]),
    [
      [true, 'identity'],
      [false, 'identity'],
    ],
  );
});

test('an aborted client request releases the CDN connection', async t => {
  const u = cdn('abort');
  let closed = false;
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.write(IMAGE.subarray(0, 1000));
    res.on('close', () => {
      closed = true;
    });
    // The rest never comes: only the proxy can end this connection.
  });
  const ac = new AbortController();
  const r = await fetch(proxied(u), { signal: ac.signal });
  const reader = r.body.getReader();
  await reader.read();
  ac.abort();
  assert.ok(await until(() => closed, 3000), 'the CDN connection stays open');
  assert.equal(fs.existsSync(cached(u)), false, 'a cut-off image went into the cache');
});

test('a cut-off response is neither cached nor kept', async t => {
  const u = cdn('cut');
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.write(IMAGE.subarray(0, 5000), () => setTimeout(() => res.socket?.destroy(), 20));
  });
  await fetch(proxied(u))
    .then(r => r.arrayBuffer())
    .catch(() => {});
  const { imgProxyFailures } = _req('src/images/imgProxyStats.js');
  assert.ok(await until(() => String(imgProxyFailures.lastError).includes(u), 3000), 'the cut was not noticed');
  const left = () => fs.readdirSync(cacheDir).filter(f => f.startsWith(proxyCacheKey(u)));
  // The temp file is removed asynchronously after the discard.
  await until(() => left().length === 0, 3000);
  assert.deepEqual(left(), []);
});

test('streamed briefly, cached with ETag', async t => {
  const u = cdn('etag');
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.end(IMAGE);
  });
  const first = await fetch(proxied(u));
  await first.arrayBuffer();
  assert.equal(first.headers.get('cache-control'), 'private, max-age=3600, must-revalidate');
  assert.ok(await until(() => fs.existsSync(cached(u))));
  const second = await fetch(proxied(u));
  await second.arrayBuffer();
  assert.match(second.headers.get('cache-control') ?? '', /must-revalidate/);
  const etag = second.headers.get('etag');
  assert.match(etag ?? '', /^"c-\d+-\d+"$/);
});
