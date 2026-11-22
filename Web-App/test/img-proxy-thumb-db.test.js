/**
 * ?thumb=1 at the image proxy against a local CDN (helpers/https-stub.js): the request gets the
 * original at once, the preview is computed in the background, and a tile wall asking for the same
 * image starts it only once.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  queueThumb without the _thumbInFlight check → red “a tile wall …” (several previews written)
 *   B  the cache path awaits createProxyPreview instead of queueThumb → red “the request does not wait …”
 *      (the preview already exists when the answer arrives)
 *   C  imgUrl() without '&thumb=1' for thumb → red “the UI asks for the preview” (public/js/images.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-imgthumb-'));
process.env.APP_ROOT = wurzel;
process.env.IMAGE_FETCHES_PER_MINUTE = '1000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const express = require('express');
const { buildAndRequire, testData, testAccess, replaceServices, testServices } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { httpsStub } = require('./helpers/https-stub');
const { portOf } = require('./helpers/server');
const { bis } = require('./helpers/time');
replaceServices('images', { setNumberInScope: async () => false });

// The preview lock holds its own connection open; recorded so that the test can close it.
const own = [];
const access = testAccess();
const connect = access.ownConnection;
access.ownConnection = async () => {
  const c = await connect.call(access);
  own.push(c);
  return c;
};

const app = express();
app.use((req, _res, next) => {
  /** @type {any} */ (req).session = { userId: 810000 + (process.pid % 100000) };
  next();
});
app.get('/p', (req, res) => _req('routes/imgProxy.js').passThroughImage(testServices(), req, res));
const srv = app.listen(0);
const proxied = u => `http://127.0.0.1:${portOf(srv)}/p?thumb=1&url=${encodeURIComponent(u)}`;

test.after(async () => {
  srv.close();
  for (const c of own) await c.end().catch(() => {});
  await testData()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('?thumb=1: original at once, the preview once in the background', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const { Jimp } = require(path.join(__dirname, '..', 'node_modules', 'jimp'));
  const imageFile = path.join(wurzel, 'cdn.png');
  await new Jimp({ width: 2400, height: 1800, color: 0x336699ff }).write(imageFile);
  const IMAGE = fs.readFileSync(imageFile);
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.end(IMAGE);
  });
  const u = `https://cdn.rebrickable.com/media/parts/thumb-${process.pid}.png`;
  const { proxyCacheKey } = _req('src/images/images.js');
  const cacheFile = path.join(wurzel, 'data', 'img_proxy_cache', proxyCacheKey(u));
  const thumbFile = `${cacheFile}_thumb.jpg`;
  const renames = [];
  const realRename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    renames.push(String(to));
    return realRename.call(fs.promises, from, to);
  });
  const get = () => fetch(proxied(u)).then(async r => Buffer.from(await r.arrayBuffer()));

  const queue = () =>
    require('./helpers/sources')
      .testContext('images')
      .faecher.slot('vorschauen', () => null);
  const drained = () => bis(() => !queue() || (queue().laufend === 0 && queue()._thumbQueue.length === 0), 10000);
  // The first request fills the disk cache (and queues its own preview, which is removed again).
  assert.ok((await get()).equals(IMAGE));
  assert.ok(await bis(() => fs.existsSync(cacheFile)), 'not cached');
  assert.ok(await drained(), 'the first preview does not finish');
  fs.rmSync(thumbFile, { force: true });
  renames.length = 0;

  await t.test('the request does not wait for the preview', async () => {
    assert.ok((await get()).equals(IMAGE), 'the answer is not the original');
    assert.equal(fs.existsSync(thumbFile), false, 'the answer waited for the preview');
  });
  await t.test('a tile wall starts the preview only once', async () => {
    await Promise.all(Array.from({ length: 6 }, get));
    assert.ok(await bis(() => fs.existsSync(thumbFile), 5000), 'no preview was made');
    // Until the background queue is empty: only then would a second preview have been written.
    const queue = require('./helpers/sources')
      .testContext('images')
      .faecher.slot('vorschauen', () => null);
    assert.ok(await bis(() => queue.laufend === 0 && queue._thumbQueue.length === 0, 5000), 'the queue does not drain');
    assert.equal(renames.filter(r => r === thumbFile).length, 1, renames.join('\n'));
  });
});

test('the UI asks for the preview', async () => {
  const { openUi, reiter, warte } = require('./helpers/ui');
  const part = {
    part_number: '3001',
    color_id: 5,
    part_name: 'Brick',
    color_name: 'Rot',
    quantity: 1,
    image_url: 'https://cdn.rebrickable.com/media/parts/3001.png',
  };
  const { w, d } = await openUi({
    '/v2/parts/manual': { success: true, parts: [part], total: 1, page: 1, page_size: 1 },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.querySelector('#manual-parts-list img[src*="img-proxy"]')), 'no proxied image');
    assert.match(d.querySelector('#manual-parts-list img[src*="img-proxy"]').getAttribute('src'), /[?&]thumb=1/);
  } finally {
    w.close();
  }
});
