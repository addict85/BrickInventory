/**
 * Image proxy (routes/imgProxy.ts) against disk and bandwidth abuse:
 * timestamps in the query part of the CDN addresses yield no new
 * cache entry, CDN fetches are throttled per account, and the cache is
 * capped, oldest use first. The CDN is a dummy of https.get,
 * APP_ROOT a separate folder — the cap would otherwise delete foreign test files.
 *
 * Counter-checks (measured on 01.11.2026):
 *   A  in imgProxy.ts `url = proxyAddress(url) ?? url` removed → red:
 *      “a timestamp in the query part does not refetch the image"
 *   B  the throttle in passThroughImage commented out → red: “the fourth
 *      foreign image is throttled"
 *   C  in cleanImageCacheOn the sorting reversed (newest first) → red:
 *      “the cap deletes the image unused the longest"
 *   D  Cache-Control of the streamed path back to `public` → red: “a
 *      timestamp …” (private missing)
 *   E  in passThroughImage the CDN's raw Content-Type set again →
 *      red: “a comma list in the Content-Type …” (04.11.2026)
 * Counter-checks (measured on 08.11.2026):
 *   F  the type check in passThroughImage lets SVG through → red: “only images
 *      leave the image proxy”
 *   G  fromCdn answers 404 with `res.status(404)` instead of sendPlaceholder
 *      → red: “a missing image comes as a placeholder …”; rememberMissing()
 *      removed → same place red (second fetch at the CDN)
 *   H  403 is also remembered (`r.status === 404 || r.status === 403`) → red:
 *      “only 404 is remembered, no 403”
 *   I  in fromCdn `imgProxyFailures.notFound++` or `.error++` deleted → red:
 *      “errors are counted and logged”; likewise the message
 *      “CDN antwortete …” on console.info instead of console.error for 403
 *   J  in bildProbe() `looks_like` without the JPEG branch or the probe without
 *      'Accept-Encoding': 'identity' → red: “the probe shows WHAT …”
 *   K  (15.11.2026) in cleanImageCacheOn() the loop over images/sets deleted →
 *      red: “images/sets counts in the cap …” (0 instead of 1 deleted)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-bildproxy-'));
process.env.APP_ROOT = wurzel;
// The placeholder for missing images lies under APP_ROOT/public.
fs.mkdirSync(path.join(wurzel, 'public', 'assets'), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, '..', 'public', 'assets', 'set-placeholder.svg'),
  path.join(wurzel, 'public', 'assets', 'set-placeholder.svg'),
);
process.env.IMAGE_FETCHES_PER_MINUTE = '3';
const express = require('express');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { warte: pause, bis } = require('./helpers/time');
const { portOf } = require('./helpers/server');
// Without a database: no set is in the view, nothing is stored.
require('./helpers/sources').replaceServices('images', { setNumberInScope: async () => false });
const passThroughImage = (...a) =>
  _req('routes/imgProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
const { cleanImageCacheOn } = _req('src/images/imgCacheServe.js');
const cacheDir = path.join(wurzel, 'data', 'img_proxy_cache');

const geholt = [];
const kopfzeilen = [];
let cdnType = 'image/png';
let cdnStatus = 200;
let cdnBody = Buffer.alloc(300, 7);
let cdnHeader = {};
let cdnNetworkError = false;
const echt = https.get;
/** @type {any} */ (https).get = (url, o, cb) => {
  geholt.push(String(url));
  kopfzeilen.push(o?.headers ?? {});
  const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
  const image = cdnBody;
  if (cdnNetworkError) {
    setImmediate(() => req.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })));
    return req;
  }
  setImmediate(() =>
    cb(
      Object.assign(Readable.from([image]), {
        statusCode: cdnStatus,
        headers: { 'content-type': cdnType, 'content-length': String(image.length), ...cdnHeader },
      }),
    ),
  );
  return req;
};

const app = express();
let konto = 0;
app.use((req, _res, next) => {
  /** @type {any} */ (req).session = { userId: konto };
  next();
});
app.get('/p', passThroughImage);
const srv = app.listen(0);
const basis = `http://127.0.0.1:${portOf(srv)}/p?url=`;
const hole = address =>
  fetch(basis + encodeURIComponent(address)).then(async r => ({
    status: r.status,
    n: (await r.arrayBuffer()).byteLength,
    cache: r.headers.get('cache-control'),
  }));
// The cache writes after the response; the wait is for the files, not for a fixed time.
const imagesInCache = () =>
  fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => /^[0-9a-f]{40}$/.test(f)).length : 0;

test.after(async () => {
  https.get = echt;
  srv.close();
  await testData()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('a timestamp in the query part does not fetch the image anew', async () => {
  konto = 700000 + (process.pid % 100000);
  geholt.length = 0;
  const a = await hole('https://cdn.rebrickable.com/media/sets/10294-1.jpg?1700000000');
  assert.equal(a.status, 200);
  assert.ok(await bis(() => imagesInCache() >= 1), 'the first image does not end up in the cache');
  const b = await hole('https://cdn.rebrickable.com/media/sets/10294-1.jpg?1800000000#x');
  assert.equal(b.status, 200);
  // Only for logged-in users: a shared cache must not hold the response.
  assert.match(`${a.cache} ${b.cache}`, /^private,.* private,/);
  assert.deepEqual(geholt, ['https://cdn.rebrickable.com/media/sets/10294-1.jpg']);
  // Where the query part determines the image, it stays — sorted.
  await hole('https://www.bricklink.com/getPic.asp?itemNo=3001&colorID=5');
  assert.equal(geholt.at(-1), 'https://www.bricklink.com/getPic.asp?colorID=5&itemNo=3001');
  await bis(() => imagesInCache() >= 2);
  assert.equal(imagesInCache(), 2);
});

test('the fourth foreign image is throttled, hits and other accounts are not', async () => {
  konto = 600000 + (process.pid % 100000);
  for (let i = 1; i <= 3; i++)
    assert.equal((await hole(`https://cdn.rebrickable.com/media/parts/d${i}.png`)).status, 200);
  const fourthItem = await fetch(basis + encodeURIComponent('https://cdn.rebrickable.com/media/parts/d4.png'));
  assert.equal(fourthItem.status, 429);
  assert.ok(Number(fourthItem.headers.get('retry-after')) > 0);
  assert.ok(await bis(() => imagesInCache() >= 5), 'd1 to d3 do not end up in the cache');
  assert.equal((await hole('https://cdn.rebrickable.com/media/parts/d1.png')).status, 200, 'Cache hit throttled');
  konto += 1;
  assert.equal((await hole('https://cdn.rebrickable.com/media/parts/d4.png')).status, 200, 'other account throttled');
  // The cache keeps writing after the response; if the file only lands in the
  // next test, it counts against the cap there (seen like that in the full run).
  const bilder = () => fs.readdirSync(cacheDir).filter(f => /^[0-9a-f]{40}$/.test(f)).length;
  for (const ende = Date.now() + 5000; bilder() < 6 && Date.now() < ende; ) await pause(100);
  assert.equal(bilder(), 6);
});

test("a comma list in the CDN's Content-Type does not go out", async () => {
  konto = 500000 + (process.pid % 100000);
  const typ = async (cdn, address) => {
    cdnType = cdn;
    const r = await fetch(basis + encodeURIComponent(address));
    await r.arrayBuffer();
    return [r.status, r.headers.get('content-type')];
  };
  try {
    assert.deepEqual(await typ('image/png, text/html', 'https://cdn.rebrickable.com/media/parts/k1.png'), [
      200,
      'image/jpeg',
    ]);
    assert.deepEqual(await typ('image/webp; q=1', 'https://cdn.rebrickable.com/media/parts/k2.webp'), [
      200,
      'image/webp',
    ]);
  } finally {
    cdnType = 'image/png';
  }
  // The cache keeps writing after the response; the cap below would otherwise count it.
  for (
    const ende = Date.now() + 5000;
    fs.readdirSync(cacheDir).filter(f => f.endsWith('.ct')).length < 8 && Date.now() < ende;
  )
    await pause(100);
});

test('only images leave the image proxy', async () => {
  // On the allowed CDNs there are partly user uploads; HTML or SVG would
  // otherwise run under our origin.
  konto = 400000 + (process.pid % 100000);
  try {
    for (const [typ, address] of [
      ['text/html', 'h1.png'],
      ['image/svg+xml', 's1.svg'],
      ['application/octet-stream', 'o1.png'],
    ]) {
      cdnType = typ;
      const r = await fetch(basis + encodeURIComponent(`https://cdn.rebrickable.com/media/parts/${address}`));
      await r.arrayBuffer();
      assert.equal(r.status, 415, `${typ} went out as an image`);
    }
  } finally {
    cdnType = 'image/png';
  }
});

test('a missing image comes as a placeholder, and the server remembers it', async () => {
  konto = 300000 + (process.pid % 100000);
  const platzhalter = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'set-placeholder.svg'));
  const address = 'https://cdn.rebrickable.com/media/sets/fehlt-1.jpg';
  cdnStatus = 404;
  try {
    geholt.length = 0;
    const fetchRaw = async () => {
      const r = await fetch(basis + encodeURIComponent(address));
      return { status: r.status, typ: r.headers.get('content-type'), rumpf: Buffer.from(await r.arrayBuffer()) };
    };
    const erst = await fetchRaw();
    assert.equal(erst.status, 200, 'A 404 of the CDN goes to the browser as an error');
    assert.equal(erst.typ, 'image/svg+xml');
    assert.ok(erst.rumpf.equals(platzhalter), 'The placeholder is not delivered');
    assert.equal(geholt.length, 2, 'Before giving up the proxy asks once more without a referer');
    const zweit = await fetchRaw();
    assert.ok(zweit.status === 200 && zweit.rumpf.equals(platzhalter));
    assert.equal(geholt.length, 2, 'The missing image is not remembered — every tile asks the CDN again');
  } finally {
    cdnStatus = 200;
  }
});

test('only 404 is remembered, no 403', async () => {
  // At the CDN 403 is often only throttling; remembered, images that exist would be missing.
  konto = 200000 + (process.pid % 100000);
  cdnStatus = 403;
  try {
    geholt.length = 0;
    const address = basis + encodeURIComponent('https://cdn.rebrickable.com/media/sets/gesperrt-1.jpg');
    for (let i = 0; i < 2; i++) {
      const r = await fetch(address);
      await r.arrayBuffer();
      assert.equal(r.status, 403);
    }
    assert.equal(geholt.length, 4, 'A 403 was remembered — the second fetch did not go to the CDN');
  } finally {
    cdnStatus = 200;
  }
});

test('the cap deletes the image unused the longest', async () => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const now = Date.now() / 1000;
  const put = (schluessel, alterDays) => {
    for (const [name, n] of [
      [schluessel, 1000],
      [`${schluessel}.ct`, 9],
      [`${schluessel}_thumb.jpg`, 300],
    ]) {
      const p = path.join(cacheDir, name);
      fs.writeFileSync(p, Buffer.alloc(n));
      fs.utimesSync(p, now - alterDays * 86400, now - alterDays * 86400);
    }
  };
  put('a'.repeat(40), 20);
  put('b'.repeat(40), 10);
  put('c'.repeat(40), 1);
  assert.equal(await cleanImageCacheOn(4000, now * 1000), 0, 'nothing is deleted below the limit');
  assert.equal(await cleanImageCacheOn(3000, now * 1000), 3);
  assert.deepEqual(
    fs
      .readdirSync(cacheDir)
      .map(f => f[0])
      .sort()
      .join(''),
    'bbbccc',
  );
});

test('images/sets counts in the cap and stays', async () => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const sets = path.join(wurzel, 'data', 'images', 'sets');
  fs.mkdirSync(sets, { recursive: true });
  fs.writeFileSync(path.join(sets, '10294-1.jpg'), Buffer.alloc(2000));
  const now = Date.now() / 1000;
  for (const [schluessel, alterDays] of /** @type {[string, number][]} */ ([
    ['a'.repeat(40), 5],
    ['b'.repeat(40), 1],
  ])) {
    const p = path.join(cacheDir, schluessel);
    fs.writeFileSync(p, Buffer.alloc(1000));
    fs.utimesSync(p, now - alterDays * 86400, now - alterDays * 86400);
  }
  // 2000 bytes in the cache would be below 3500, with images/sets it is 4000.
  assert.equal(await cleanImageCacheOn(3500, now * 1000), 1);
  assert.deepEqual(fs.readdirSync(cacheDir), ['b'.repeat(40)]);
  assert.deepEqual(fs.readdirSync(sets), ['10294-1.jpg']);
  fs.rmSync(sets, { recursive: true, force: true });
});

test('errors are counted and logged', async () => {
  const { imgProxyFailures: f } = _req('src/images/imgProxyStats.js');
  const vorher = { ...f };
  const error = [];
  const echtError = console.error;
  console.error = (...a) => error.push(a.join(' '));
  try {
    for (const [status, netz, address] of /** @type {[number, boolean, string][]} */ ([
      [404, false, 'https://cdn.rebrickable.com/media/sets/zaehl-404.jpg'],
      [403, false, 'https://cdn.rebrickable.com/media/sets/zaehl-403.jpg'],
      [200, true, 'https://cdn.rebrickable.com/media/sets/zaehl-netz.jpg'],
    ])) {
      // One account per fetch: the throttle (three per minute) should not apply here.
      konto = 400000 + status * 1000 + (process.pid % 1000);
      cdnStatus = status;
      cdnNetworkError = netz;
      const r = await fetch(basis + encodeURIComponent(address));
      await r.arrayBuffer();
      if (netz) assert.equal(r.status, 502);
    }
  } finally {
    console.error = echtError;
    cdnStatus = 200;
    cdnNetworkError = false;
  }
  assert.deepEqual([f.notFound - vorher.notFound, f.other - vorher.other, f.error - vorher.error], [1, 1, 1]);
  assert.match(f.lastError, /ECONNRESET/);
  assert.ok(
    error.some(z => z.includes('CDN antwortete 403') && z.includes('zaehl-403')),
    error.join('\n'),
  );
  assert.ok(
    error.some(z => z.includes('Verbindungsfehler') && z.includes('ECONNRESET')),
    error.join('\n'),
  );
});

test('the probe shows WHAT is delivered', async () => {
  const { imageProbe: imageCheck } = _req('src/management/diagnostics.js');
  const address = 'https://cdn.rebrickable.com/media/sets/probe-1.jpg';
  try {
    cdnBody = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    kopfzeilen.length = 0;
    const jpeg = await imageCheck(address);
    assert.equal(jpeg.body_check.looks_like, 'JPEG');
    assert.match(jpeg.body_check.first_bytes_hex, /^ff d8 ff e0/);
    assert.deepEqual(
      jpeg.probes.map(p => [p.variant, p.status]),
      [
        ['mit Referer', 200],
        ['ohne Referer', 200],
        ['nackt', 200],
      ],
    );
    // The same request as the proxy: uncompressed.
    assert.equal(kopfzeilen.at(-1)['Accept-Encoding'], 'identity');
    assert.equal(typeof jpeg.proxy_failures.notFound, 'number');
    // A CDN that compresses anyway shows up in the response.
    cdnBody = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);
    cdnHeader = { 'content-encoding': 'gzip' };
    const gz = await imageCheck(address);
    assert.deepEqual([gz.body_check.looks_like, gz.probes[0].content_encoding], ['gzip (komprimiert!)', 'gzip']);
  } finally {
    cdnBody = Buffer.alloc(300, 7);
    cdnHeader = {};
  }
});
